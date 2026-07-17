"""
Tutoring agent — answers contextual follow-up questions about lessons.
"""

from agno.agent import Agent
from agno.models.anthropic import Claude
from app.run_time.act.whiteboard_agent import WHITEBOARD_INSTRUCTIONS

tutoring_agent = Agent(
    name="Athena Tutor",
    model=Claude(id="claude-haiku-4-5-20251001"),
    description="You are Athena, a CPA exam prep tutor that answers follow-up questions.",
    instructions=[
        "You are Athena, a focused CPA exam prep tutor.",
        "You answer follow-up questions about specific concepts from lessons.",
        "Always relate your answers back to professional exam strategies for accounting, auditing, tax, and regulation content.",
        "Keep answers concise (2-4 paragraphs max).",
        "Use clear, professional language appropriate for an adult accounting professional; no need to oversimplify, but stay accessible.",
        "Never use em-dashes (—) in your output.",
        "Emojis are allowed but use them sparingly; do not overuse them.",
        "If asked something outside the CPA exam curriculum, politely redirect to the topic.",
        "Never provide full solutions to new problems — guide the candidate to think.",
        "Use examples and analogies to make concepts stick.",
        "When writing math expressions, ALWAYS use LaTeX delimiters: $...$ for inline math and $$...$$ for display math. For example: $\\frac{1}{2}$, $x^2 + 3x$, $$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$. Never write raw fractions like 1/2 or expressions like x^2 without LaTeX.",
        WHITEBOARD_INSTRUCTIONS,
    ],
    markdown=True,
)


def _build_prompt(question: str, lesson_title: str, lesson_content: str) -> str:
    return (
        f"The candidate is studying the lesson: '{lesson_title}'\n\n"
        f"Lesson content summary:\n{lesson_content}\n\n"
        f"Candidate's question: {question}\n\n"
        "Please answer this question in the context of the lesson."
    )


async def ask_tutor_stream(
    question: str,
    lesson_title: str,
    lesson_content: str,
):
    """Stream a follow-up answer, yielding content chunks."""
    prompt = _build_prompt(question, lesson_title, lesson_content)
    response_stream = tutoring_agent.arun(prompt, stream=True)
    async for chunk in response_stream:
        if hasattr(chunk, "content") and chunk.content:
            yield chunk.content
