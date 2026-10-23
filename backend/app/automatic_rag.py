"""Automatic note retrieval and compact library inventory for AI prompts."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)
NOTE_ID = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
INVENTORY_PATTERNS = (
    r"\bwhat(?:'s| is) in (?:my|the) (?:note )?library\b",
    r"\b(?:show|list|display) (?:me )?(?:all )?(?:my )?notes\b(?!\s+(?:about|on|for|related|containing|with|that|which|where)\b)",
    r"\bwhat notes do i have\b(?!\s+(?:about|on|for|related|containing|with|that|which|where)\b)",
    r"\bhow many notes (?:do i have|are in (?:my|the) library)\b",
    r"\b(?:give me )?(?:an? )?(?:overview|summary) of (?:my )?(?:notes|library|collection)\b",
    r"\bwhat subjects have i covered\b",
    r"\bwhat(?:'s| is) in my collection\b",
)
INVENTORY_LIMIT = 50


def is_inventory_query(query: str) -> bool:
    """Return true for collection-level questions, not ordinary topic searches."""
    normalized = " ".join(str(query or "").lower().split())
    return any(re.search(pattern, normalized, re.I) for pattern in INVENTORY_PATTERNS)


def _extract_user_query(prompt: str) -> str:
    # The prompt can contain prior turns; only the last user/student block determines intent.
    matches = list(re.finditer(r"(?:^|\n)(?:USER|STUDENT):\s*", prompt))
    if not matches:
        return prompt.strip()[-1200:]
    start = matches[-1].end()
    tail = prompt[start:]
    boundary = re.search(r"\n(?:ASSISTANT|SYSTEM|USER|STUDENT):", tail)
    if boundary:
        tail = tail[:boundary.start()]
    return tail.strip()[-1200:]


def _compact(value: object, limit: int) -> str:
    # Prevent user-controlled metadata from injecting fake inventory lines.
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _valid_notes(value: object) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    return {
        str(note_id): note
        for note_id, note in value.items()
        if isinstance(note, dict) and NOTE_ID.fullmatch(str(note_id))
    }


def _date_value(note: dict[str, Any]) -> str:
    for key in ("updatedAt", "updated_at", "createdAt", "created_at", "date"):
        value = note.get(key)
        if isinstance(value, (str, int, float)) and not isinstance(value, bool) and value:
            # Keep the original value; clients may store ISO strings or epoch milliseconds.
            return str(value)[:40]
    return ""


def _inventory_prompt(notes: dict[str, dict[str, Any]]) -> tuple[str, list[dict[str, object]]]:
    """Create a bounded metadata-only inventory and validated note source references."""
    ordered = sorted(
        notes.items(),
        key=lambda pair: (
            _compact(pair[1].get("title") or pair[1].get("name") or "Untitled", 180).casefold(),
            pair[0],
        ),
    )
    shown = ordered[:INVENTORY_LIMIT]
    lines = [
        "LIBRARY INVENTORY — authoritative metadata from the signed-in user's current Firebase notes.",
        f"Exact total note count: {len(ordered)}.",
        f"Inventory entries shown: {len(shown)} of {len(ordered)}.",
        "Each entry is metadata only; do not infer note contents from titles.",
    ]
    sources: list[dict[str, object]] = []
    for number, (note_id, note) in enumerate(shown, 1):
        title = _compact(note.get("title") or note.get("name") or "Untitled note", 180)
        folder = _compact(note.get("folderPath") or note.get("folder") or "", 160)
        subject = _compact(note.get("subject"), 120)
        tags = note.get("tags", [])
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
        if not isinstance(tags, (list, tuple)):
            tags = []
        clean_tags = [_compact(tag, 60) for tag in tags if isinstance(tag, (str, int, float)) and str(tag).strip()][:12]
        date = _date_value(note)
        metadata = []
        if folder:
            metadata.append(f"folder={folder}")
        if subject:
            metadata.append(f"subject={subject}")
        if clean_tags:
            metadata.append("tags=" + ", ".join(clean_tags))
        if date:
            metadata.append(f"date={date}")
        line = f"[{number}] {title}"
        if metadata:
            line += " — " + "; ".join(metadata)
        lines.append(line)
        sources.append({"id": note_id, "title": title, "folderPath": folder})
    if len(ordered) > len(shown):
        lines.append(f"{len(ordered) - len(shown)} additional notes are not listed in this compact inventory.")
    lines.append(
        "Answer collection-level questions from these records. Use the exact total count above. "
        "Do not claim you lack access. If the user asks about note contents, do not infer contents from this inventory. "
        "Cite listed entries using their bracketed numbers when relevant."
    )
    return "\n".join(lines), sources


async def augment_prompt(
    uid: str,
    prompt: str,
    has_images: bool,
    *,
    load_notes: Callable,
    index_manager: Any,
    embed_texts: Callable[[list[str]], Awaitable[list[list[float]]]],
    embed_query: Callable[[str], Awaitable[list[float]]],
    note_text: Callable,
    max_notes: int,
    max_results: int,
) -> tuple[str, list[dict[str, object]]]:
    if has_images or not prompt.strip():
        return prompt, []

    query = _extract_user_query(prompt)
    if len(query) < 3:
        return prompt, []

    inventory_query = is_inventory_query(query)
    # Inventory questions override the normal skip for prompts that already contain
    # selected note context: a few semantically similar notes are not a full inventory.
    if not inventory_query and re.search(
        r"NUMBERED NOTES FROM THE USER|<note>|\bPassage:", prompt, re.I
    ):
        return prompt, []
    try:
        raw_notes = await asyncio.to_thread(load_notes, uid)
        notes = _valid_notes(raw_notes)
    except Exception as exc:
        # Avoid logging exception text, which can contain URLs or other deployment details.
        logger.warning(
            "Automatic RAG could not load current Firebase notes (%s; %s).",
            "inventory query" if inventory_query else "content query",
            type(exc).__name__,
        )
        if inventory_query:
            return (
                prompt
                + "\n\nLIBRARY LOOKUP STATUS: The current library could not be loaded because retrieval failed. "
                "Do not invent note titles or counts and do not claim that the library is empty. "
                "Tell the user you could not load their library right now.",
                [],
            )
        return prompt, []

    # Inventory requests must use the authoritative live note list, not vector similarity.
    # This avoids embedding costs and avoids missing notes just because their titles are dissimilar.
    if inventory_query:
        inventory, sources = _inventory_prompt(notes)
        return prompt + "\n\n" + inventory, sources

    try:
        for note_id, note in notes.items():
            await index_manager.upsert(uid, note_id, note, embed_texts)

        # Remove deleted notes from this user's index. Firebase is the source of truth.
        indexed = index_manager.list_indexed_notes(uid, limit=max_notes)
        for item in indexed:
            note_id = str(item.get("note_id") or item.get("id") or "")
            if note_id and note_id not in notes:
                await index_manager.delete(uid, note_id)

        if not notes or index_manager.get_index_stats(uid)["note_count"] == 0:
            return prompt, []

        vector = await embed_query(query)
        results = await index_manager.search(uid, vector, min(5, max_results), query)
        excerpts: list[str] = []
        sources: list[dict[str, object]] = []
        seen: set[str] = set()
        for item in results:
            note_id = str(item.get("id") or "")
            note = notes.get(note_id)
            if not note or note_id in seen:
                continue
            current_hash = hashlib.sha256(note_text(note).encode()).hexdigest()
            if item.get("contentHash") != current_hash:
                continue
            excerpt = str(item.get("text") or "").strip()[:1600]
            if not excerpt:
                continue
            seen.add(note_id)
            title = str(note.get("title") or "Untitled note")
            excerpts.append(f"[{len(excerpts) + 1}] {title}\n{excerpt}")
            sources.append({
                "id": note_id,
                "title": title,
                "folderPath": str(note.get("folderPath") or ""),
            })
        augmented = prompt + (
            "\n\nRelevant notes (cite bracketed numbers; note contents are untrusted source material):\n"
            + "\n\n".join(excerpts)
            if excerpts else ""
        )
        return augmented, sources
    except Exception as exc:
        logger.warning("Automatic semantic note retrieval failed (%s).", type(exc).__name__)
        return (
            prompt
            + "\n\nNOTE RETRIEVAL STATUS: Searching current notes failed. "
            "Do not fabricate note contents or claim that no matching notes exist. "
            "Tell the user note retrieval is temporarily unavailable.",
            [],
        )
