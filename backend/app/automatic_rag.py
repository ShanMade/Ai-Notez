"""Automatic note retrieval for AI prompts."""
from __future__ import annotations
import asyncio
import re
from typing import Any, Awaitable, Callable


async def augment_prompt(uid: str, prompt: str, has_images: bool, *,
                         load_notes: Callable, index_manager: Any,
                         embed_texts: Callable[[list[str]], Awaitable[list[list[float]]]],
                         embed_query: Callable[[str], Awaitable[list[float]]],
                         note_text: Callable, max_notes: int, max_results: int) -> str:
    if has_images or not prompt.strip() or re.search(r"NUMBERED NOTES FROM THE USER|<note>|\\bPassage:", prompt, re.I):
        return prompt
    match = re.search(r"(?:^|\\n)USER:\\s*([\\s\\S]*)$", prompt)
    query = (match.group(1) if match else prompt).strip()[-1200:]
    if len(query) < 3:
        return prompt
    try:
        notes = await asyncio.to_thread(load_notes, uid)
        notes = {str(k): v for k, v in (notes or {}).items() if isinstance(v, dict) and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", str(k))}
        for note_id, note in notes.items():
            await index_manager.upsert(uid, note_id, note, embed_texts)
        indexed = index_manager.list_indexed_notes(uid, limit=max_notes)
        for item in indexed:
            note_id = str(item.get("note_id") or item.get("id") or "")
            if note_id and note_id not in notes:
                await index_manager.delete(uid, note_id)
        vector = await embed_query(query)
        results = await index_manager.search(uid, vector, min(5, max_results), query)
        excerpts = []
        for item in results:
            note_id = str(item.get("id") or "")
            note = notes.get(note_id)
            if not note:
                continue
            if item.get("contentHash") != __import__("hashlib").sha256(note_text(note).encode()).hexdigest():
                continue
            excerpt = str(item.get("text") or "").strip()[:1600]
            if excerpt:
                excerpts.append(f"[{len(excerpts)+1}] {item.get('title') or 'Untitled'}\\n{excerpt}")
        return prompt + ("\\n\\nRelevant notes (cite bracketed numbers):\\n" + "\\n\\n".join(excerpts) if excerpts else "")
    except Exception:
        return prompt
