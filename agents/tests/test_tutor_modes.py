import asyncio

import pytest

from app.run_time.act import quiz_tutor_agent as qta
from app.run_time.act.tutor_modes import (
    REDACTED,
    AnswerLeakGuard,
    mode_instructions,
    normalize_mode,
)

OPTIONS = ["$12,000", "$45,000", "$57,000", "$33,000"]
QUESTION = "Revenue is $90,000 and expenses are $45,500. What is the adjusted amount?"
CORRECT = 1  # B) $45,000


async def _chunks(text: str, size: int):
    for i in range(0, len(text), size):
        yield text[i:i + size]


def _collect(agen) -> str:
    async def run():
        return "".join([c async for c in agen])
    return asyncio.run(run())


@pytest.mark.parametrize("text", [
    "The answer is B.",
    "So option B is right.",
    "Pick (B) here.",
    "B) is the one.",
    "B is correct because...",
    "Answer: **B**",
    "The result is $45,000.",
    "That gives $45{,}000$ in total.",
    "That gives 45000 overall.",
])
def test_guard_redacts_correct_option(text):
    out = AnswerLeakGuard(CORRECT, OPTIONS, QUESTION).redact(text)
    assert REDACTED in out
    assert "45,000" not in out and "45{,}000" not in out and "45000" not in out


@pytest.mark.parametrize("text", [
    "A company records revenue of $90,000.",  # article 'A', figure from the question
    "Expenses were $45,500 this year.",  # different number sharing a prefix
    "Bonds are issued at par.",
])
def test_guard_keeps_harmless_text(text):
    assert AnswerLeakGuard(CORRECT, OPTIONS, QUESTION).redact(text) == text


@pytest.mark.parametrize("size", [1, 3, 7, 50])
def test_guard_catches_matches_split_across_chunks(size):
    text = "Work it through. The correct answer is option B: $45,000. Nice."
    out = _collect(AnswerLeakGuard(CORRECT, OPTIONS, QUESTION).guard(_chunks(text, size)))
    assert "option B" not in out and "45,000" not in out
    assert out.startswith("Work it through.") and out.endswith("Nice.")


def test_text_option_redacted():
    opts = ["Accrual basis", "Cash basis", "Modified cash basis", "Tax basis"]
    out = AnswerLeakGuard(3, opts, "Which basis?").redact("Use the tax  basis here.")
    assert "tax" not in out.lower()


def test_mode_instructions():
    assert normalize_mode("nope") == "hint"
    assert "ONE short nudge" in mode_instructions("hint", False)
    assert "NOT answered" in mode_instructions("guided", False)
    assert "STOP before the final computed figure" in mode_instructions("full", False)
    assert "each wrong option" in mode_instructions("full", True).lower()
    assert "misconception" in mode_instructions("why_wrong", True)


def _ask(mode, student_answer):
    return _collect(qta.ask_quiz_tutor_stream(
        question="help", topic="t", subtopic="s", question_text=QUESTION, options=OPTIONS,
        hint="h", solution_steps=[], correct_option=CORRECT, student_answer=student_answer, mode=mode,
    ))


@pytest.mark.parametrize("mode", ["hint", "guided", "full", "why_wrong"])
def test_no_mode_leaks_before_answering(monkeypatch, mode):
    # The mock LLM deliberately states the key; the server guard must strip it.
    monkeypatch.setenv("AGENT_MOCK_LLM", "1")
    out = _ask(mode, None)
    assert out.startswith("[mock:")
    assert "option B" not in out and "45,000" not in out
    assert REDACTED in out


def test_full_after_answering_reveals_and_why_wrong_names_choice(monkeypatch):
    monkeypatch.setenv("AGENT_MOCK_LLM", "1")
    assert "option B: $45,000" in _ask("full", 2)
    why = _ask("why_wrong", 2)
    assert why.startswith("[mock:why_wrong]") and "option C: $57,000" in why


def test_prompt_contains_mode_block():
    p = qta._build_quiz_prompt("q", "t", "s", QUESTION, OPTIONS, "h", [], CORRECT, None, mode="guided")
    assert "TUTORING MODE: GUIDED" in p
