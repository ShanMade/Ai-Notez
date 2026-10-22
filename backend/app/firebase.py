from __future__ import annotations

import threading

import firebase_admin
from firebase_admin import auth, db
from firebase_admin.exceptions import FirebaseError

from .config import settings

_app = None
_lock = threading.Lock()


def firebase_app():
    global _app
    if _app:
        return _app
    with _lock:
        if _app:
            return _app
        options = {"projectId": settings.firebase_project_id}
        if settings.database_url:
            options["databaseURL"] = settings.database_url
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            _app = firebase_admin.initialize_app(options=options)
        return _app


def verify_id_token(token: str) -> dict:
    try:
        return auth.verify_id_token(token, app=firebase_app(), check_revoked=True)
    except (ValueError, FirebaseError) as exc:
        raise ValueError("The Firebase ID token is invalid or expired.") from exc


def user_note(uid: str, note_id: str) -> dict | None:
    if not settings.database_url:
        raise RuntimeError("FIREBASE_DATABASE_URL is required for note indexing.")
    value = db.reference(f"users/{uid}/notes/{note_id}", app=firebase_app()).get()
    return value if isinstance(value, dict) else None


def user_notes(uid: str) -> dict[str, dict]:
    if not settings.database_url:
        raise RuntimeError("FIREBASE_DATABASE_URL is required for index rebuilds.")
    value = db.reference(f"users/{uid}/notes", app=firebase_app()).get()
    return value if isinstance(value, dict) else {}
