"""
Problem Generator Agent — produces CPA exam problems with full solutions.
Generates in small batches (5) with retry and JSON repair for robustness.
"""

import json
import re
from agno.agent import Agent
from agno.models.anthropic import Claude

BATCH_SIZE = 10  # 10 per batch — large enough to be fast, small enough to avoid truncation
MAX_RETRIES = 3

SUBJECT_LABELS = {
    "aud": "CPA Auditing and Attestation (AUD)",
    "far": "CPA Financial Accounting and Reporting (FAR)",
    "reg": "CPA Regulation (REG)",
    "bar": "CPA Business Analysis and Reporting (BAR)",
    "isc": "CPA Information Systems and Controls (ISC)",
    "tcp": "CPA Tax Compliance and Planning (TCP)",
}

problem_agent = Agent(
    name="CPA Problem Generator",
    model=Claude(id="claude-sonnet-4-6"),
    description="You generate realistic CPA Exam problems with full solutions.",
    instructions=[
        "You are an expert CPA Exam problem writer.",
        "Given a subtopic, its context, and the subject area (CPA Exam section), generate a batch of CPA Exam-style multiple choice problems.",
        "Each problem must have EXACTLY 4 answer choices (A-D).",
        "Return ONLY a valid JSON array of problem objects with these exact keys:",
        "- difficulty: string ('easy' | 'medium' | 'hard')",
        "- questionText: string (the problem text — use LaTeX with $...$ notation for computations/formulas, and plain text for conceptual/regulatory scenarios; always escape currency dollar signs as \\$ e.g. write \\$5 not $5)",
        "- options: string[] (exactly 4 answer choices — use LaTeX if needed for numeric/formula answers, plain text otherwise; always escape currency dollar signs as \\$ e.g. write \\$5 not $5)",
        "- correctOption: number (0-3, index of the correct answer)",
        "- explanation: string (full worked explanation, keep concise)",
        "- solutionSteps: { step: number, instruction: string, math: string }[] (2-4 steps max — for conceptual/regulatory problems the 'math' field contains the relevant rule/citation/text instead of an equation)",
        "- conceptTags: string[] (fine-grained tags like 'revenue-recognition-asc606', 'independence-rules', 'basis-of-property')",
        "- commonErrors: { error: string, why: string }[] (1-2 typical candidate mistakes)",
        "- timeRecommendationSeconds: number (target solve time)",
        "- cpaFrequency: string ('high' | 'medium' | 'low')",
        "- hint: string (a nudge without giving away the answer — names the method or standard, points to what is given)",
        "- detailedHint: string (walks through the reasoning step by step, leaving only the final computation or conclusion for the candidate — gets close but does NOT give away the answer)",
        "- optionHints: { optionIndex: number, misconception: string, hint: string }[] (one entry for EACH of the 3 wrong options — optionIndex is its 0-3 index; misconception is a short label naming the specific error that choice reflects e.g. 'Confusing accrual with cash basis'; hint nudges the candidate away from that specific misconception without revealing the correct answer)",
        "Keep explanations and steps CONCISE to stay within output limits.",
        "Problems should be realistic CPA Exam-style questions with varying difficulty, reflecting real professional/technical accounting scenarios (per the current AICPA Blueprints) — not passage-based reading comprehension.",
        "Ensure all answers are correct, unambiguous, and technically accurate per current authoritative literature (GAAP, GAAS, IRC, etc. as applicable).",
        "Never use em-dashes (—) in any text fields.",
        "Emojis are allowed but use them sparingly; do not overuse them.",
        "Return ONLY the JSON array, no markdown code fences or extra text.",
    ],
    markdown=False,
)


def _extract_json_array(text: str) -> list[dict]:
    """Extract and parse a JSON array from LLM output, handling common issues."""
    content = text.strip()

    # Strip markdown code fences
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
        content = content.rsplit("```", 1)[0].strip()

    # Try direct parse first
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Try to find the array boundaries
    start = content.find("[")
    if start == -1:
        raise ValueError("No JSON array found in response")

    # Try parsing from the array start
    try:
        return json.loads(content[start:])
    except json.JSONDecodeError:
        pass

    # Truncated output: try to salvage complete objects
    # Find the last complete object (ending with })
    last_brace = content.rfind("}")
    if last_brace == -1:
        raise ValueError("No complete JSON objects found")

    # Take everything up to the last } and close the array
    truncated = content[start : last_brace + 1]
    # Remove any trailing comma before we close
    truncated = truncated.rstrip().rstrip(",")
    if not truncated.endswith("]"):
        truncated += "]"

    try:
        return json.loads(truncated)
    except json.JSONDecodeError:
        pass

    # Last resort: extract individual objects with regex
    objects = []
    for match in re.finditer(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content):
        try:
            obj = json.loads(match.group())
            if "questionText" in obj:
                objects.append(obj)
        except json.JSONDecodeError:
            continue

    if objects:
        return objects

    raise ValueError(f"Could not parse JSON from LLM output (length={len(content)})")


PROBLEM_TYPE_ROTATIONS = [
    "word problems set in real-world contexts (finance, science, everyday situations)",
    "pure algebraic / symbolic manipulation problems",
    "problems involving tables, graphs, or data interpretation",
    "multi-step problems that chain two or more concepts together",
    "problems where a common student error leads to a tempting wrong answer",
]


async def generate_problems_batch(
    subtopic_name: str,
    topic_name: str,
    subtopic_id: str,
    batch_number: int,
    difficulty: str = "medium",
    batch_size: int = BATCH_SIZE,
    start_order_index: int = 0,
    subject: str = "aud",
) -> list[dict]:
    """Generate a batch of CPA Exam problems via LLM with retry logic.

    All problems in a batch share the same difficulty level so that callers
    can independently parallelize easy/medium/hard generation.
    """
    subject_label = SUBJECT_LABELS.get(subject, "CPA Auditing and Attestation (AUD)")

    problem_type = PROBLEM_TYPE_ROTATIONS[batch_number % len(PROBLEM_TYPE_ROTATIONS)]

    prompt = (
        f"Subject: {subject_label}\n"
        f"Topic: {topic_name}\n"
        f"Subtopic: {subtopic_name}\n"
        f"Difficulty: {difficulty} (ALL {batch_size} problems must be {difficulty} difficulty)\n"
        f"Batch: {batch_number + 1}\n"
        f"Problem type focus: {problem_type}\n"
        f"Generate exactly {batch_size} {difficulty} {subject_label} problems.\n"
        f"Make each problem unique and cover different aspects of {subtopic_name}.\n"
        "Do not repeat question structures or contexts from earlier batches."
    )

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = await problem_agent.arun(prompt)
            problems = _extract_json_array(response.content)

            # Validate we got at least 1 problem
            if not problems:
                raise ValueError("Empty problems array")

            # Add DB fields
            result = []
            for i, p in enumerate(problems):
                result.append({
                    "subtopic_id": subtopic_id,
                    "order_index": start_order_index + i,
                    "difficulty": difficulty,
                    "question_text": p["questionText"],
                    "options": p["options"],
                    "correct_option": p["correctOption"],
                    "explanation": p.get("explanation", ""),
                    "solution_steps": p.get("solutionSteps", []),
                    "concept_tags": p.get("conceptTags", []),
                    "common_errors": p.get("commonErrors", []),
                    "time_recommendation_seconds": p.get("timeRecommendationSeconds", 120),
                    "cpa_frequency": p.get("cpaFrequency", "medium"),  # LLM returns cpaFrequency (camelCase)
                    "hint": p.get("hint", ""),
                    "detailed_hint": p.get("detailedHint", ""),
                    "option_hints": p.get("optionHints", []),
                })
            return result

        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                print(f"⚠", end="", flush=True)

    raise RuntimeError(
        f"Failed to generate problems after {MAX_RETRIES} attempts for "
        f"{subtopic_name} batch {batch_number}: {last_error}"
    )
