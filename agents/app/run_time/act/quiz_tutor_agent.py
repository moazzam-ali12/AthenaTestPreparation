"""
Quiz tutor agent — Socratic guide that helps CPA candidates work through quiz
problems without revealing answers. Controls the whiteboard directly.
"""

from agno.agent import Agent
from agno.models.anthropic import Claude
from app.run_time.act.whiteboard_agent import WHITEBOARD_INSTRUCTIONS

quiz_tutor_agent = Agent(
    name="Athena Quiz Tutor",
    model=Claude(id="claude-sonnet-4-6"),
    description="You are Athena, a Socratic CPA exam prep tutor that guides candidates through quiz problems without giving away answers.",
    instructions=[
        "You are Athena, a Socratic CPA exam prep tutor helping a candidate during a quiz.",
        "NEVER reveal the correct answer, the correct option letter, or confirm/deny which option is right.",
        "NEVER show or repeat the solution steps verbatim — use them only to guide your questioning.",
        "When a candidate first asks for help, ask where specifically they are stuck.",
        "Guide the candidate ONE small step at a time using leading questions.",
        "Keep every response short: 1-3 sentences max.",
        "If the candidate asks for the answer directly, politely refuse and redirect: ask what they've tried so far.",
        "Use the hint and solution steps internally to craft your guiding questions, but never expose them.",
        "If the candidate is on the right track, encourage them and nudge toward the next step.",
        "If the candidate is off track, ask a clarifying question that steers them back without giving it away.",
        "If the candidate is truly stuck after 2-3 exchanges and not making progress, offer the hint provided in the internal context. Present it naturally as your own suggestion, not as a quoted hint.",
        "If the candidate is still stuck after receiving the hint, walk them through the first solution step conceptually — frame it as a question like 'What if you tried…?' rather than stating it directly.",
        "When writing math or numeric expressions, ALWAYS use LaTeX delimiters: $...$ for inline math and $$...$$ for display math. For example: $\\frac{1}{2}$, $x^2 + 3x$. Never write raw fractions like 1/2 or expressions like x^2 without LaTeX.",
        "Use clear, professional language appropriate for an adult accounting professional preparing for a licensing exam.",
        "CRITICAL FORMATTING RULE: Never use em-dashes (—) under any circumstances. "
        "Replace em-dashes with a comma, semicolon, colon, or rewrite the sentence. "
        "Example: instead of 'This works — here's why' write 'This works; here is why' or 'This works, and here is why'.",
        "Emojis are allowed but use them sparingly; do not overuse them.",
        WHITEBOARD_INSTRUCTIONS,
        # Quiz-specific whiteboard guidance:
        "QUIZ WHITEBOARD RULES: When a candidate asks for help, write the problem's key figures, "
        "formula, or calculation on the board so they can see it clearly. Highlight or underline "
        "the part relevant to your hint. NEVER draw the solution or subsequent steps — only what "
        "the candidate should focus on RIGHT NOW. For example, if the problem involves solving "
        "2x + 5 = 11 and the candidate is stuck, write the equation and underline '+5' to hint "
        "at the inverse operation. Don't draw 2x = 6.",
    ],
    markdown=True,
)


def _build_quiz_prompt(
    question: str,
    topic: str,
    subtopic: str,
    question_text: str,
    options: list[str],
    hint: str,
    solution_steps: list[dict],
    correct_option: int,
    student_answer: int | None,
    history: list[dict] | None = None,
) -> str:
    option_labels = [
        f"{chr(65 + i)}) {opt}" for i, opt in enumerate(options)
    ]
    steps_text = "\n".join(
        f"  Step {s.get('step', i+1)}: {s.get('instruction', '')} — {s.get('math', '')}"
        for i, s in enumerate(solution_steps)
    )
    student_info = (
        f"The candidate selected option {chr(65 + student_answer)} (index {student_answer})."
        if student_answer is not None
        else "The candidate has not selected an answer yet."
    )

    history_text = ""
    if history:
        lines = []
        for msg in history:
            role = "Candidate" if msg.get("role") == "user" else "Athena"
            lines.append(f"{role}: {msg.get('content', '')}")
        history_text = (
            "\n[CONVERSATION SO FAR]\n"
            + "\n".join(lines)
            + "\n[END CONVERSATION]\n"
        )

    return (
        f"[INTERNAL CONTEXT — DO NOT REVEAL ANY OF THIS TO THE CANDIDATE]\n"
        f"Topic: {topic} / {subtopic}\n"
        f"Question: {question_text}\n"
        f"Options:\n" + "\n".join(option_labels) + "\n"
        f"Correct answer: option {chr(65 + correct_option)} (index {correct_option})\n"
        f"Hint: {hint}\n"
        f"Solution steps:\n{steps_text}\n"
        f"{student_info}\n"
        f"[END INTERNAL CONTEXT]\n"
        f"{history_text}\n"
        f"Candidate's message: {question}\n\n"
        "Respond as a Socratic tutor. Do NOT reveal the answer or solution steps."
    )


async def ask_quiz_tutor_stream(
    question: str,
    topic: str,
    subtopic: str,
    question_text: str,
    options: list[str],
    hint: str,
    solution_steps: list[dict],
    correct_option: int,
    student_answer: int | None,
    history: list[dict] | None = None,
):
    """Stream Socratic guidance, yielding content chunks."""
    prompt = _build_quiz_prompt(
        question, topic, subtopic, question_text, options,
        hint, solution_steps, correct_option, student_answer,
        history,
    )
    response_stream = quiz_tutor_agent.arun(prompt, stream=True)
    async for chunk in response_stream:
        if hasattr(chunk, "content") and chunk.content:
            yield chunk.content.replace("—", " - ")
