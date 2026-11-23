"""
Shared quality rules for LLM-generated CPA problems: a concrete difficulty
rubric (so "hard" means the same thing in every batch), structural
validation, and an optional independent answer-key check.
"""

import json

from agno.agent import Agent
from agno.models.anthropic import Claude

# Numeric difficulty_level stored per band. Must stay in sync with
# DIFFICULTY_TIER_LEVELS in src/lib/adaptive/engine.ts.
DIFFICULTY_LEVELS = {
    "easy": 3,
    "medium": 5,
    "hard": 8,
}

# Injected into every generator prompt. Without a definition, each batch
# interprets "easy/medium/hard" differently and the 3/5/8 difficulty_level
# mapping used by the adaptive engine stops meaning anything.
DIFFICULTY_RUBRIC = (
    "Difficulty definitions (follow these exactly):\n"
    "- easy: tests ONE concept. Direct recall or direct application of a single rule, "
    "definition, or formula to clean facts. One step. Distractors are clearly wrong to "
    "someone who knows the rule.\n"
    "- medium: applies a rule to a realistic scenario with 1-2 steps or one judgment call "
    "(e.g. classify then measure, identify the applicable standard then apply it). At least "
    "one distractor reflects a common candidate error.\n"
    "- hard: multi-step, or combines two or more rules/standards, or hinges on an exception, "
    "threshold, or timing nuance. Includes extraneous facts the candidate must ignore. Every "
    "distractor is the result of a specific, plausible mistake."
)

# CPA-appropriate variety; rotated by batch number.
PROBLEM_TYPE_ROTATIONS = [
    "straightforward application of the core rule or concept",
    "problems where a common candidate error leads to a tempting wrong answer",
    "multi-step problems that chain two or more concepts together",
    "real-world engagement or business context problems",
    "problems involving data, schedules, or tables",
    "problems that hinge on an exception, threshold, or timing rule",
]


def is_valid_problem(p: dict) -> bool:
    """Structural checks the UI and grading depend on."""
    options = p.get("options")
    correct = p.get("correctOption")
    return (
        isinstance(p.get("questionText"), str)
        and bool(p["questionText"].strip())
        and isinstance(options, list)
        and len(options) == 4
        and all(isinstance(o, str) and o.strip() for o in options)
        and len({o.strip() for o in options}) == 4
        and isinstance(correct, int)
        and not isinstance(correct, bool)
        and 0 <= correct <= 3
    )


_verifier_agent = Agent(
    name="CPA Answer Verifier",
    model=Claude(id="claude-sonnet-4-6"),
    description="You independently solve CPA Exam multiple choice questions.",
    instructions=[
        "You are an expert CPA. Solve each multiple choice question independently and carefully.",
        "Return ONLY a JSON array with one integer per question, in order: the 0-3 index of the single best answer.",
        "If a question is ambiguous or has no correct option or more than one correct option, return -1 for it.",
        "No markdown code fences or extra text.",
    ],
    markdown=False,
)


async def verify_answer_keys(problems: list[dict], subject_label: str, strict: bool = False) -> list[dict]:
    """
    Re-solves each problem without seeing its answer key and keeps only the
    problems where the independent answer matches. A wrong key marks correct
    candidates as wrong, which is worse than serving one fewer question.

    `problems` are raw generator objects (camelCase keys). On verifier failure,
    returns the input unchanged rather than dropping everything, unless
    `strict`, where unverified problems are dropped (nothing unchecked ships).
    """
    if not problems:
        return problems

    questions = [
        {"question": p["questionText"], "options": p["options"]} for p in problems
    ]
    prompt = (
        f"Section: {subject_label}\n"
        f"Solve these {len(questions)} questions:\n"
        f"{json.dumps(questions, indent=2)}"
    )

    try:
        response = await _verifier_agent.arun(prompt)
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        answers = json.loads(content[content.find("["):])
    except Exception as e:
        print(f"  ⚠ answer verification skipped: {e}", flush=True)
        return [] if strict else problems

    if not isinstance(answers, list) or len(answers) != len(problems):
        print("  ⚠ answer verification skipped: verifier returned wrong count", flush=True)
        return [] if strict else problems

    verified = [p for p, a in zip(problems, answers) if a == p["correctOption"]]
    dropped = len(problems) - len(verified)
    if dropped:
        print(f"  ⚠ dropped {dropped} problem(s) with a disputed answer key", flush=True)
    return verified
