"""Tests for the deterministic TBS quality checks (no LLM / DB calls).

Run: cd agents && python -m pytest tests -q
"""

import copy

import pytest

from app.pre_generation.tbs_generator import _grading_key, _public_fields, pick_samples
from app.pre_generation.tbs_quality import (
    answers_match,
    check_tbs,
    exhibit_numbers,
    recompute_numeric,
    safe_eval,
    validate_tbs,
)

ACCOUNTS = ["Cash", "Accounts Receivable", "Sales Revenue", "Unearned Revenue", "Inventory"]

GOOD = {
    "title": "Revenue recognition for a bundled contract",
    "difficulty": "medium",
    "instructions": "Use the exhibits to complete each item.",
    "estMinutes": 15,
    "explanation": "ASC 606 allocation...",
    "exhibits": [
        {"id": "ex1", "title": "Contract memo", "kind": "text", "body": "Total contract price is $12,000, billed upfront. Discount 8%."},
        {
            "id": "ex2",
            "title": "Standalone prices",
            "kind": "table",
            "table": {"columns": ["Item", "Price"], "rows": [["Equipment", 9000], ["Service", 3000]]},
        },
    ],
    "fields": [
        {"id": "f1", "type": "numeric", "label": "Revenue for equipment", "points": 2},
        {"id": "f2", "type": "option_list", "label": "Timing", "points": 1, "options": ["Point in time", "Over time"]},
        {"id": "f3", "type": "journal_entry", "label": "Entry at billing", "points": 3, "accounts": ACCOUNTS},
    ],
    "answers": {
        "f1": {"type": "numeric", "value": 9000, "formula": "total * equip / (equip + service)",
               "inputs": {"total": 12000, "equip": 9000, "service": 3000}},
        "f2": {"type": "option_list", "value": "Point in time"},
        "f3": {"type": "journal_entry", "lines": [
            {"account": "Cash", "side": "debit", "amount": 12000},
            {"account": "Sales Revenue", "side": "credit", "amount": 9000},
            {"account": "Unearned Revenue", "side": "credit", "amount": 3000},
        ]},
    },
}


def mutate(fn):
    task = copy.deepcopy(GOOD)
    fn(task)
    return task


def test_good_task_passes():
    assert check_tbs(GOOD) == []


@pytest.mark.parametrize(
    "fn, expected",
    [
        (lambda t: t["answers"].pop("f2"), "has no answer key"),
        (lambda t: t["answers"]["f2"].update(value="Never"), "not one of the options"),
        (lambda t: t["answers"]["f3"]["lines"][0].update(amount=11000), "does not balance"),
        (lambda t: t["answers"]["f3"]["lines"][0].update(account="Goodwill"), "not in chart of accounts"),
        (lambda t: t.update(fields=t["fields"][:2]), "needs 3-8 fields"),
        (lambda t: t["fields"][1].update(id="f1"), "unique"),
        (lambda t: t["answers"]["f1"].update(type="option_list"), "key type"),
        (lambda t: t.update(difficulty="extreme"), "difficulty"),
        (lambda t: t["exhibits"][1]["table"]["rows"].append(["Only one cell"]), "every row"),
        (lambda t: t.update(exhibits=[]), "at least one exhibit"),
        (lambda t: t["answers"].update(f9={"type": "numeric", "value": 1}), "unknown fields"),
    ],
)
def test_bad_schema_rejected(fn, expected):
    errors = validate_tbs(mutate(fn))
    assert any(expected in e for e in errors), errors


def test_wrong_recomputed_number_rejected():
    task = mutate(lambda t: t["answers"]["f1"].update(value=8000))
    errors = check_tbs(task)
    assert any("formula gives 9,000.00" in e for e in errors), errors


def test_input_missing_from_exhibits_rejected():
    task = mutate(lambda t: t["answers"]["f1"]["inputs"].update(total=15000))
    errors = recompute_numeric(task)
    assert any("total=15000 does not appear" in e for e in errors), errors


def test_constants_and_percentages_allowed():
    task = mutate(lambda t: t["answers"]["f1"].update(
        value=720, formula="total * rate / const_months * 0 + total * rate * 0.75",
        inputs={"total": 12000, "rate": 0.08, "const_months": 12},
    ))
    assert recompute_numeric(task) == []


def test_numeric_without_formula_is_skipped():
    task = mutate(lambda t: t["answers"]["f1"].update(value=1234, formula=None))
    assert recompute_numeric(task) == []


def test_safe_eval_blocks_code():
    assert safe_eval("round(a / b, 2)", {"a": 1, "b": 3}) == 0.33
    for bad in ["__import__('os')", "a.__class__", "[1][0]", "a ** 2", "open('x')"]:
        with pytest.raises((ValueError, SyntaxError)):
            safe_eval(bad, {"a": 2})


def test_exhibit_numbers_parses_text_and_tables():
    nums = exhibit_numbers(GOOD["exhibits"])
    assert {12000, 9000, 3000, 8, 0.08} <= nums


def test_answers_match_mirrors_grader():
    je = GOOD["answers"]["f3"]
    reordered = [{"account": "unearned revenue", "debit": None, "credit": 3000},
                 {"account": "Cash", "debit": 12000, "credit": None},
                 {"account": "Sales Revenue", "debit": None, "credit": 9000}]
    assert answers_match(je, reordered)
    assert answers_match(je, list(reversed(je["lines"])))
    assert not answers_match(je, je["lines"][:2])
    assert answers_match({"type": "numeric", "value": 9000}, 9000.4)
    assert not answers_match({"type": "numeric", "value": 9000}, 9001)
    assert not answers_match({"type": "option_list", "value": "A"}, "B")


def test_stored_key_and_fields_are_stripped():
    key = _grading_key(GOOD["answers"])
    assert key["f1"] == {"type": "numeric", "value": 9000}
    fields = _public_fields([{**GOOD["fields"][0], "answer": 9000}])
    assert "answer" not in fields[0]


def test_pick_samples_prefers_easy_and_skips_sections_with_sample():
    recs = [
        {"section": "far", "difficulty": "medium", "status": "approved", "task": GOOD},
        {"section": "far", "difficulty": "easy", "status": "approved", "task": GOOD},
        {"section": "far", "difficulty": "easy", "status": "draft", "task": GOOD},
        {"section": "aud", "difficulty": "easy", "status": "approved", "task": GOOD},
    ]
    pick_samples(recs, sections_with_sample={"aud"})
    assert [bool(r.get("is_sample")) for r in recs] == [False, True, False, False]
