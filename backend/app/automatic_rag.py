"""Automatic retrieval helpers for Notez AI."""

from __future__ import annotations

import re


def should_retrieve(prompt: str, has_images: bool = False) -> bool:
    if has_images or not prompt.strip():
        return False
    if re.search(r"NUMBERED NOTES FROM THE USER|<note>|\bPassage:", prompt, re.I):
        return False
    return True
