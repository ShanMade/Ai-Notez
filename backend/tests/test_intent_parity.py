"""Runs the shared intent cases against the generated backend patterns.

The browser side runs the same cases in scripts/intent-parity.test.mjs.
"""
import json
from pathlib import Path

import pytest

from app.automatic_rag import is_inventory_query
from app.intent_patterns import INVENTORY_PATTERNS

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "shared" / "intent-cases.json").read_text(encoding="utf-8"))
SPEC = json.loads((ROOT / "shared" / "intent-patterns.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["q"] for case in CASES])
def test_shared_intent_cases(case):
    assert is_inventory_query(case["q"]) is case["inventory"]


def test_generated_patterns_match_shared_source():
    expected = tuple(
        pattern.replace("TOPIC", SPEC["topicWords"]) for pattern in SPEC["inventory"]
    )
    assert INVENTORY_PATTERNS == expected
