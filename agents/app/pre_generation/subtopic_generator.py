"""
Subtopic Generator Agent — produces rich subtopic metadata for CPA exam content.
"""

import json
from agno.agent import Agent
from agno.models.anthropic import Claude

SUBJECT_LABELS = {
    "aud": "CPA Auditing and Attestation (AUD)",
    "far": "CPA Financial Accounting and Reporting (FAR)",
    "reg": "CPA Regulation (REG)",
    "bar": "CPA Business Analysis and Reporting (BAR)",
    "isc": "CPA Information Systems and Controls (ISC)",
    "tcp": "CPA Tax Compliance and Planning (TCP)",
}

subtopic_agent = Agent(
    name="CPA Subtopic Generator",
    model=Claude(id="claude-sonnet-4-6"),
    description="You generate comprehensive CPA exam subtopic metadata.",
    instructions=[
        "You are an expert CPA exam content developer.",
        "Given a subtopic name, its parent topic context, and the subject area, generate rich metadata.",
        "Return ONLY valid JSON with these exact keys:",
        "- description: string (2-3 sentences describing the subtopic)",
        "- learningObjectives: string[] (3-5 specific learning objectives)",
        "- keyFormulas: { latex: string, description: string }[] (key formulas, standards, or rules relevant to this subtopic — use LaTeX notation for quantitative/computational content, plain text for rules, standards references, or procedures)",
        "- commonMistakes: { mistake: string, correction: string, why: string }[] (3-5 common mistakes candidates make)",
        "- tipsAndTricks: string[] (3-5 specific strategies for mastering this subtopic)",
        "- difficulty: string ('easy' | 'medium' | 'hard')",
        "- estimatedMinutes: number (study time for this subtopic)",
        "- prerequisiteSubtopicSlugs: string[] (slugs of prerequisite subtopics, can be empty)",
        "- conceptualOverview: { definition: string, realWorldExample: string, cpaContext: string, visualDescription: string }",
        "For quantitative/computational subtopics: use LaTeX notation like \\frac{a}{b}, x^2, \\sqrt{x}, etc. in keyFormulas.",
        "For conceptual/procedural/regulatory subtopics: keyFormulas should contain key rules, standards citations, or techniques (use plain text, not LaTeX).",
        "Be specific to the actual CPA Exam content and format (per the current AICPA Blueprints), and write for a working professional accountant audience.",
        "Never use em-dashes (—) in any text fields.",
        "Emojis are allowed but use them sparingly; do not overuse them.",
        "Return ONLY the JSON object, no markdown code fences or extra text.",
    ],
    markdown=False,
)


async def generate_subtopic(
    name: str,
    topic_name: str,
    topic_id: str,
    order_index: int,
    all_subtopic_names: list[str],
    subject: str = "aud",
) -> dict:
    """Generate rich subtopic metadata via LLM."""
    subject_label = SUBJECT_LABELS.get(subject, "CPA Auditing and Attestation (AUD)")
    prompt = (
        f"Subject: {subject_label}\n"
        f"Parent Topic: {topic_name}\n"
        f"Subtopic: {name}\n"
        f"Order Index (within topic): {order_index}\n"
        f"All subtopics in this topic: {', '.join(all_subtopic_names)}\n\n"
        "Generate the complete subtopic metadata JSON."
    )
    response = await subtopic_agent.arun(prompt)
    data = json.loads(response.content)

    slug = name.lower().replace(" ", "-").replace("(", "").replace(")", "").replace(",", "")
    return {
        "topic_id": topic_id,
        "slug": slug,
        "name": name,
        "order_index": order_index,
        "description": data["description"],
        "learning_objectives": data["learningObjectives"],
        "key_formulas": data["keyFormulas"],
        "common_mistakes": data["commonMistakes"],
        "tips_and_tricks": data["tipsAndTricks"],
        "difficulty": data["difficulty"],
        "estimated_minutes": data["estimatedMinutes"],
        "prerequisite_subtopic_slugs": data["prerequisiteSubtopicSlugs"],
        "conceptual_overview": data["conceptualOverview"],
    }
