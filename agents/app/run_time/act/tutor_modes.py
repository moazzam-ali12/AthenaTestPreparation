"""
Quiz-tutor modes (Hint / Guided / Full explanation / Why was I wrong?) and the
server-side answer-leak guard.

The guard is the enforcement for "no mode reveals the correct option before the
candidate answers": the prompt asks the model not to, and the guard redacts any
reference to the correct option (its letter or its text/value) from the stream.
"""

from __future__ import annotations

import os
import re
from typing import AsyncIterator

TUTOR_MODES = ("hint", "guided", "full", "why_wrong")
REDACTED = "[hidden until you answer]"


def normalize_mode(mode: str | None) -> str:
    return mode if mode in TUTOR_MODES else "hint"


def mode_instructions(mode: str, answered: bool) -> str:
    """Per-request TUTORING MODE block appended to the prompt."""
    mode = normalize_mode(mode)
    if mode == "hint":
        return (
            "TUTORING MODE: HINT.\n"
            "- Give exactly ONE short nudge (1-2 sentences) toward the next idea.\n"
            "- Do NOT give the answer or the correct option, do NOT substitute numbers into a formula, "
            "do NOT show solution steps or intermediate results.\n"
            "- Do not use the whiteboard for more than highlighting one given figure."
        )
    if mode == "guided":
        rules = (
            "TUTORING MODE: GUIDED.\n"
            "- Work through the solution as a sequence of small steps. In each reply, ask the candidate to do "
            "ONE step themselves (a question, not a statement of the result).\n"
            "- When the candidate's last message attempts a step, check it: say whether it is right, and if not, "
            "point at the specific error without doing it for them. Then ask for the next step.\n"
            "- Keep each reply to 1-4 sentences.\n"
        )
        if answered:
            rules += "- Only confirm the final answer once the candidate has computed it themselves."
        else:
            rules += (
                "- The candidate has NOT answered yet: never state the final figure or which option is correct, "
                "even if they ask or reach it. Tell them to select it on the question card."
            )
        return rules
    if mode == "full":
        if answered:
            return (
                "TUTORING MODE: FULL EXPLANATION.\n"
                "- Give the complete worked solution, one numbered step per line, with the reasoning for each step.\n"
                "- State the correct option and its value.\n"
                "- Then, for EACH wrong option, one line on why it is wrong (the mistake that produces it).\n"
                "- If the candidate chose a wrong option, address that option first."
            )
        return (
            "TUTORING MODE: FULL EXPLANATION (candidate has NOT answered yet).\n"
            "- Explain the concept, the rule or formula, and set up every step of the method with the given figures.\n"
            "- STOP before the final computed figure: do not state the result, do not say which option is "
            "correct, and do not evaluate or eliminate any option.\n"
            "- End by telling the candidate to finish the last step and pick an option; the full solution with "
            "why each wrong option is wrong unlocks after they answer."
        )
    # why_wrong
    return (
        "TUTORING MODE: WHY WAS I WRONG?\n"
        "- The candidate chose a wrong option. Name that option (letter and value) and explain the SPECIFIC "
        "misconception or calculation error that leads to it (e.g. wrong rule, wrong base, sign error, timing).\n"
        "- Contrast it with the correct reasoning in 2-3 sentences and give the correct option.\n"
        "- End with one sentence on how to avoid this mistake. Max ~8 sentences. "
        "Do not list practice questions; the app attaches them."
    )


# --------------------------------------------------------------------------- #
# Answer-leak guard
# --------------------------------------------------------------------------- #

_SEP = r"(?:,|\{,\}|\\,|\s)?"  # thousands separators incl. LaTeX "{,}" and "\,"


def _number_pattern(text: str) -> str | None:
    """Regex for a numeric option ("$45,000", "12.5%") that tolerates $, separators and LaTeX."""
    m = re.fullmatch(r"\s*\(?\s*\\?\$?\s*(-?)\s*([\d,]+)(\.\d+)?\s*\)?\s*(%|\\%)?\s*", text)
    if not m:
        return None
    digits = m.group(2).replace(",", "")
    if len(digits) < 2 and not m.group(3):
        return None  # single digits are too common to redact safely
    groups = []
    head = len(digits) % 3 or 3
    groups.append(digits[:head])
    groups.extend(digits[i:i + 3] for i in range(head, len(digits), 3))
    body = _SEP.join(groups)
    frac = re.escape(m.group(3)) if m.group(3) else ""
    return rf"(?:\\?\$\s*)?(?<![\d.]){body}{frac}(?![\d])"


def _norm(s: str) -> str:
    return re.sub(r"[\s,$\\{}]", "", s).lower()


class AnswerLeakGuard:
    """Redacts references to the correct option from tutor output."""

    def __init__(self, correct_option: int, options: list[str], question_text: str = ""):
        letter = chr(65 + correct_option)
        word = r"(?i:option|choice|answer|letter)"
        patterns = [
            rf"{word}\s*(?:(?i:is|would be|=)\s*)?:?\s*[\(\[*]*{letter}[\)\]*]*(?![A-Za-z0-9])",
            rf"\({letter}\)",
            rf"(?<![A-Za-z0-9\\]){letter}\)",
            rf"(?<![A-Za-z0-9]){letter}\s+(?i:is)\s+(?i:the\s+)?(?i:correct|right|best)",
        ]
        self._max_len = 60
        opt = options[correct_option] if 0 <= correct_option < len(options) else ""
        if opt and _norm(opt) and _norm(opt) not in _norm(question_text):
            num = _number_pattern(opt)
            if num:
                patterns.append(num)
            elif len(opt.strip()) >= 4:
                words = [re.escape(w) for w in opt.strip().split()]
                patterns.append(r"(?i:" + r"\s+".join(words) + ")")
            self._max_len = max(self._max_len, len(opt) * 2 + 20)
        self._re = re.compile("|".join(f"(?:{p})" for p in patterns))

    def redact(self, text: str) -> str:
        return self._re.sub(REDACTED, text)

    async def guard(self, stream: AsyncIterator[str]) -> AsyncIterator[str]:
        """Streams redacted text, holding back a tail so matches split across chunks are caught."""
        pending = ""
        async for chunk in stream:
            pending = self.redact(pending + chunk)
            if len(pending) > self._max_len:
                cut = len(pending) - self._max_len
                yield pending[:cut]
                pending = pending[cut:]
        if pending:
            yield self.redact(pending)


# --------------------------------------------------------------------------- #
# Mock LLM (E2E): AGENT_MOCK_LLM=1 makes the quiz tutor answer deterministically
# and deliberately "leak" the key, so tests prove the guard (not the prompt) holds.
# --------------------------------------------------------------------------- #

def mock_llm_enabled() -> bool:
    return os.getenv("AGENT_MOCK_LLM", "").lower() in ("1", "true", "yes")


async def mock_tutor_stream(
    mode: str, options: list[str], correct_option: int, student_answer: int | None
) -> AsyncIterator[str]:
    key = f"option {chr(65 + correct_option)}: {options[correct_option]}"
    if mode == "why_wrong" and student_answer is not None:
        text = (
            f"[mock:why_wrong] You chose option {chr(65 + student_answer)}: {options[student_answer]}. "
            f"That choice comes from a misconception. The correct answer is {key}."
        )
    elif mode == "hint":
        text = f"[mock:hint] Think about which rule applies first. The answer is {key}."
    elif mode == "guided":
        text = f"[mock:guided] Step 1: what do you get for the first figure? (It leads to {key}.)"
    else:
        text = f"[mock:full] Step 1: set up. Step 2: compute. So the correct answer is {key}."
    for i in range(0, len(text), 7):  # small chunks exercise the split-match hold-back
        yield text[i:i + 7]
