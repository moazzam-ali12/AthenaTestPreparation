"""
CPA Problem Generator — produces CPA Exam-style problems across all 6 sections
(AUD, FAR, REG, BAR, ISC, TCP) with full solutions.

Requires ANTHROPIC_API_KEY with credits.
Run: python -m cli.main seed-cpa-exam-bank --section all --count 50
"""

import asyncio
import json

from agno.agent import Agent
from agno.models.anthropic import Claude

BATCH_SIZE = 10
MAX_RETRIES = 3

CPA_SUBJECT_LABELS = {
    "aud": "CPA Auditing and Attestation (AUD)",
    "far": "CPA Financial Accounting and Reporting (FAR)",
    "reg": "CPA Regulation (REG)",
    "bar": "CPA Business Analysis and Reporting (BAR)",
    "isc": "CPA Information Systems and Controls (ISC)",
    "tcp": "CPA Tax Compliance and Planning (TCP)",
}

cpa_problem_agent = Agent(
    name="CPA Problem Generator",
    model=Claude(id="claude-sonnet-4-6"),
    description="You generate realistic CPA Exam problems with full solutions.",
    instructions=[
        "You are an expert CPA Exam problem writer with deep knowledge of AICPA content specifications.",
        "Given a section, topic, subtopic, and difficulty, generate a batch of CPA Exam-style multiple choice problems.",
        "Each problem must have EXACTLY 4 answer choices (A-D).",
        "Return ONLY a valid JSON array of problem objects with these exact keys:",
        "- difficulty: string ('easy' | 'medium' | 'hard')",
        "- questionText: string (the problem — for FAR/BAR use precise numbers and, where useful, LaTeX $...$ notation for formulas; for AUD/REG/ISC/TCP include a short scenario or fact pattern)",
        "- options: string[] (exactly 4 answer choices)",
        "- correctOption: number (0-3, index of correct answer)",
        "- explanation: string (concise worked explanation citing the relevant standard, rule, or code section where applicable)",
        "- solutionSteps: { step: number, instruction: string, math: string }[] (2-4 steps max)",
        "- conceptTags: string[] (e.g. 'asc-606', 'independence-rules', 'like-kind-exchange')",
        "- commonErrors: { error: string, why: string }[] (1-2 typical candidate mistakes)",
        "- timeRecommendationSeconds: number (target solve time in seconds)",
        "- cpaFrequency: string ('high' | 'medium' | 'low') — how commonly this appears on the CPA Exam",
        "- hint: string (nudge without giving away the answer)",
        "- detailedHint: string (step-by-step reasoning, does NOT give the final answer)",
        "- optionHints: { optionIndex: number, misconception: string, hint: string }[] (one entry for EACH of the 3 wrong options — optionIndex is its 0-3 index; misconception is a short label naming the specific error that choice reflects; hint nudges the candidate away from that specific misconception without revealing the correct answer)",
        "AUD: focus on audit planning, risk assessment, evidence, internal control, and reporting scenario/procedure reasoning.",
        "FAR: focus on technical accounting calculations and application of GAAP/FASB standards.",
        "REG: focus on federal tax law and business law application problems (facts -> correct tax or legal treatment).",
        "BAR: focus on business analysis case scenarios, financial valuation, and advanced technical accounting.",
        "ISC: focus on IT governance, systems, security, and data management scenarios.",
        "TCP: focus on tax planning and compliance scenarios requiring strategic judgment.",
        "Keep explanations CONCISE to stay within output limits.",
        "Never use em-dashes (—) in any text fields.",
        "Return ONLY the JSON array, no markdown code fences or extra text.",
    ],
    markdown=False,
)


def _extract_json_array(text: str) -> list[dict]:
    content = text.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
        content = content.rsplit("```", 1)[0].strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    start = content.find("[")
    if start == -1:
        raise ValueError("No JSON array found in response")
    try:
        return json.loads(content[start:])
    except json.JSONDecodeError:
        pass
    # Truncation recovery: close off the last complete object and the array
    last_brace = content.rfind("}")
    if last_brace == -1:
        raise ValueError("No complete JSON objects found")
    truncated = content[start: last_brace + 1].rstrip().rstrip(",") + "]"
    try:
        return json.loads(truncated)
    except json.JSONDecodeError:
        raise ValueError(f"Could not parse JSON from LLM output (length={len(content)})")


PROBLEM_TYPE_ROTATIONS = [
    "straightforward application of the core rule or concept",
    "problems where a common candidate error leads to a tempting wrong answer",
    "multi-step problems that chain two or more concepts together",
    "real-world engagement or business context problems",
    "problems involving data, schedules, or tables",
]


async def generate_cpa_problems_batch(
    subtopic_name: str,
    topic_name: str,
    subtopic_id: str,
    batch_number: int,
    difficulty: str = "medium",
    batch_size: int = BATCH_SIZE,
    start_order_index: int = 0,
    subject: str = "far",
) -> list[dict]:
    subject_label = CPA_SUBJECT_LABELS.get(subject, "CPA Financial Accounting and Reporting (FAR)")
    problem_type = PROBLEM_TYPE_ROTATIONS[batch_number % len(PROBLEM_TYPE_ROTATIONS)]

    section_notes = {
        "aud": "Present a brief audit engagement scenario or procedure description. Question should test audit reasoning, risk assessment, or evidence evaluation.",
        "far": "Problems should involve precise numbers requiring a calculation, or application of a specific FASB/GAAP standard. Use LaTeX for formulas where helpful.",
        "reg": "Present a short fact pattern (taxpayer situation or business/legal scenario). Question should test correct application of federal tax law or business law.",
        "bar": "Present a business analysis or advanced technical accounting scenario (valuation, forecasting, or complex transaction). Question should test analytical or technical judgment.",
        "isc": "Describe an IT systems, security, or data governance scenario. Question should test control design, risk, or technical reasoning.",
        "tcp": "Present a tax planning scenario requiring the candidate to recommend or evaluate a compliance/planning strategy.",
    }
    note = section_notes.get(subject, "")

    prompt = (
        f"CPA Exam Section: {subject_label}\n"
        f"Topic: {topic_name}\n"
        f"Subtopic: {subtopic_name}\n"
        f"Difficulty: {difficulty} (ALL {batch_size} problems must be {difficulty} difficulty)\n"
        f"Batch: {batch_number + 1}\n"
        f"Problem type focus: {problem_type}\n"
        f"Generate exactly {batch_size} {difficulty} {subject_label} problems.\n"
        f"{note}\n"
        f"Make each problem unique and cover different aspects of {subtopic_name}.\n"
        "Do not repeat question structures or contexts from earlier batches."
    )

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = await cpa_problem_agent.arun(prompt)
            problems = _extract_json_array(response.content)
            if not problems:
                raise ValueError("Empty problems array")
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
                    "time_recommendation_seconds": p.get("timeRecommendationSeconds", 60),
                    "cpa_frequency": p.get("cpaFrequency", "medium"),
                    "hint": p.get("hint", ""),
                    "detailed_hint": p.get("detailedHint", ""),
                    "option_hints": p.get("optionHints", []),
                })
            return result
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                print(f"  ⚠ retry {attempt + 1}/{MAX_RETRIES - 1} for {subtopic_name} batch {batch_number}", flush=True)

    raise RuntimeError(
        f"Failed to generate problems after {MAX_RETRIES} attempts for "
        f"{subtopic_name} batch {batch_number}: {last_error}"
    )
