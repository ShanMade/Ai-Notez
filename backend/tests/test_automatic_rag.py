import asyncio
import hashlib

from app.automatic_rag import augment_prompt, is_inventory_query


def run(coro):
    return asyncio.run(coro)


def note_text(note):
    return "\n".join(str(note.get(key, "")) for key in ("title", "subject", "folderPath", "body")).strip()


class FakeIndex:
    def __init__(self, results=None, indexed=None, fail_search=False):
        self.results = results or []
        self.indexed = indexed or []
        self.fail_search = fail_search
        self.upserts = []
        self.deleted = []
        self.search_calls = 0

    async def upsert(self, uid, note_id, note, embed_texts):
        self.upserts.append((uid, note_id))

    def list_indexed_notes(self, uid, limit=None):
        return self.indexed[:limit] if limit else self.indexed

    async def delete(self, uid, note_id):
        self.deleted.append((uid, note_id))
        return True

    def get_index_stats(self, uid):
        return {"note_count": 1 if self.upserts else 0}

    async def search(self, uid, vector, limit, query):
        self.search_calls += 1
        if self.fail_search:
            raise RuntimeError("mock retrieval failure")
        return self.results[:limit]


async def embed_texts(texts):
    return [[0.1] for _ in texts]


async def embed_query(query):
    return [0.1]


def call(prompt, notes, index, uid="user-A"):
    def load_notes(requested_uid):
        assert requested_uid == uid
        return notes
    return run(augment_prompt(
        uid, prompt, False,
        load_notes=load_notes,
        index_manager=index,
        embed_texts=embed_texts,
        embed_query=embed_query,
        note_text=note_text,
        max_notes=100,
        max_results=5,
    ))


def test_inventory_question_includes_real_titles_and_exact_count():
    notes = {
        "math-1": {"title": "Algebra", "subject": "Math", "tags": ["exam"], "folderPath": "Study"},
        "chem-1": {"title": "Organic Chemistry", "subject": "Chemistry"},
    }
    index = FakeIndex()
    prompt, sources = call("USER: What's in my library?", notes, index)
    assert "Exact total note count: 2" in prompt
    assert "Algebra" in prompt and "Organic Chemistry" in prompt
    assert "subject=Math" in prompt and "tags=exam" in prompt
    assert [source["id"] for source in sources] == ["math-1", "chem-1"]
    assert index.search_calls == 0  # inventory does not depend on vector similarity


def test_semantic_question_retrieves_relevant_current_excerpt():
    note = {"title": "Cell Biology", "body": "Mitochondria generate cellular energy.", "folderPath": "Science"}
    digest = hashlib.sha256(note_text(note).encode()).hexdigest()
    index = FakeIndex(results=[{
        "id": "bio-1", "title": "Cell Biology", "folderPath": "Science",
        "text": "Mitochondria generate cellular energy.", "contentHash": digest,
    }])
    prompt, sources = call("USER: Explain mitochondria from my notes.", {"bio-1": note}, index)
    assert "Mitochondria generate cellular energy." in prompt
    assert sources == [{"id": "bio-1", "title": "Cell Biology", "folderPath": "Science"}]
    assert index.search_calls == 1


def test_empty_library_is_not_a_retrieval_failure():
    prompt, sources = call("USER: What's in my library?", {}, FakeIndex())
    assert "Exact total note count: 0" in prompt
    assert "could not be loaded" not in prompt
    assert sources == []


def test_firebase_failure_is_not_reported_as_empty_library():
    def broken_load(uid):
        raise RuntimeError("database unavailable")
    prompt, sources = run(augment_prompt(
        "user-A", "USER: What's in my library?", False,
        load_notes=broken_load, index_manager=FakeIndex(),
        embed_texts=embed_texts, embed_query=embed_query,
        note_text=note_text, max_notes=100, max_results=5,
    ))
    assert "retrieval failed" in prompt.lower()
    assert "Exact total note count: 0" not in prompt
    assert sources == []


def test_deleted_notes_are_removed_and_never_cited():
    index = FakeIndex(
        indexed=[{"note_id": "deleted-note"}],
        results=[{"id": "deleted-note", "title": "Deleted", "text": "old content"}],
    )
    prompt, sources = call("USER: Tell me about this topic", {}, index)
    assert ("user-A", "deleted-note") in index.deleted
    assert "old content" not in prompt
    assert sources == []


def test_notes_are_loaded_only_for_authenticated_uid():
    notes_by_uid = {"user-A": {"a1": {"title": "Private A"}}, "user-B": {"b1": {"title": "Private B"}}}
    def load_notes(uid):
        return notes_by_uid[uid]
    prompt, sources = run(augment_prompt(
        "user-A", "USER: What's in my library?", False,
        load_notes=load_notes, index_manager=FakeIndex(),
        embed_texts=embed_texts, embed_query=embed_query,
        note_text=note_text, max_notes=100, max_results=5,
    ))
    assert "Private A" in prompt
    assert "Private B" not in prompt
    assert [source["id"] for source in sources] == ["a1"]


def test_stale_index_excerpt_is_excluded_when_content_hash_differs():
    note = {"title": "Current", "body": "Updated content"}
    index = FakeIndex(results=[{
        "id": "n1", "title": "Old title", "text": "stale private content",
        "contentHash": "old-hash",
    }])
    prompt, sources = call("USER: Explain the topic in my notes.", {"n1": note}, index)
    assert "stale private content" not in prompt
    assert sources == []


def test_source_metadata_matches_only_current_notes_used_in_answer():
    note = {"title": "Physics", "body": "Newton's laws", "folderPath": "School"}
    digest = hashlib.sha256(note_text(note).encode()).hexdigest()
    index = FakeIndex(results=[{
        "id": "p1", "title": "Physics", "folderPath": "School",
        "text": "Newton's laws", "contentHash": digest,
    }, {
        "id": "other-user-note", "title": "Other", "text": "should not leak",
        "contentHash": digest,
    }])
    prompt, sources = call("USER: Explain Newton's laws.", {"p1": note}, index)
    assert "Newton's laws" in prompt
    assert "should not leak" not in prompt
    assert sources == [{"id": "p1", "title": "Physics", "folderPath": "School"}]


def test_semantic_retrieval_failure_is_reported_without_fabrication():
    index = FakeIndex(fail_search=True)
    prompt, sources = call(
        "USER: What did I write about photosynthesis?",
        {"n1": {"title": "Biology", "body": "Photosynthesis converts light energy."}},
        index,
    )
    assert "retrieval is temporarily unavailable" in prompt.lower()
    assert sources == []


def test_inventory_intent_detection():
    assert is_inventory_query("What's in my library?")
    assert is_inventory_query("How many notes do I have?")
    assert is_inventory_query("Give me an overview of my collection")
    assert not is_inventory_query("Explain photosynthesis from my notes")


def test_inventory_overrides_existing_semantic_context_skip():
    index = FakeIndex()
    prompt, sources = call(
        'NUMBERED NOTES FROM THE USER\'S LIBRARY:\n[1] Irrelevant note\n<note>old context</note>\nUSER: What\'s in my library?',
        {"a1": {"title": "Actual inventory note"}},
        index,
    )
    assert "Exact total note count: 1" in prompt
    assert "Actual inventory note" in prompt
    assert sources == [{"id": "a1", "title": "Actual inventory note", "folderPath": ""}]
    assert index.search_calls == 0


def test_latest_user_message_controls_inventory_intent():
    prompt, sources = call(
        "USER: What's in my library?\nASSISTANT: Here is an overview.\nUSER: Explain photosynthesis.",
        {"bio": {"title": "Biology", "body": "Photosynthesis details"}},
        FakeIndex(),
    )
    assert "LIBRARY INVENTORY" not in prompt
    assert sources == []
