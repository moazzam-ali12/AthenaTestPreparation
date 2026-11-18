"""
Quiz tutor agent — Socratic guide that helps CPA candidates work through quiz
problems without revealing answers. Controls the whiteboard directly.
"""

from agno.agent import Agent
from agno.models.anthropic import Claude
from app.run_time.act.whiteboard_agent import WHITEBOARD_INSTRUCTIONS
from app.run_time.act.tutor_modes import (
    AnswerLeakGuard,
    mock_llm_enabled,
    mock_tutor_stream,
    mode_instructions,
    normalize_mode,
)

quiz_tutor_agent = Agent(
    name="Athena Quiz Tutor",
    model=Claude(id="claude-sonnet-4-6"),
    description="You are Athena, a Socratic CPA exam prep tutor that guides candidates through quiz problems without giving away answers.",
    instructions=[
        "You are Athena, a CPA exam prep tutor helping a candidate during a quiz.",
        "Each message ends with a TUTORING MODE block (Hint, Guided, Full explanation or Why was I wrong?). "
        "Follow it exactly; it overrides the general guidance below when they conflict.",
        "Unless the TUTORING MODE explicitly allows it, NEVER reveal the correct answer, the correct option letter, "
        "or confirm/deny which option is right, and never repeat the solution steps verbatim.",
        "If the candidate asks for the answer directly while it is not allowed, politely refuse and suggest "
        "they answer first or switch to the Full explanation after answering.",
        "ADAPT TO THE CANDIDATE'S LEVEL when a proficiency level is provided in the internal context: "
        "for 'beginner' or 'developing', break steps into smaller pieces, use plainer language, define "
        "terms as they come up, and give a little extra encouragement. For 'proficient' or 'advanced', "
        "be more concise, skip the basics, and ask more demanding Socratic questions that stretch them. "
        "Never mention the level or their stats to the candidate.",
        "If the candidate is off track, ask a clarifying question that steers them back.",
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
        "the candidate should focus on RIGHT NOW (in Full explanation mode after answering, you may draw the "
        "worked steps). For example, if the problem involves solving "
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
    skill_level: str | None = None,
    performance_summary: str | None = None,
    mode: str = "hint",
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

    level_info = ""
    if skill_level:
        level_info = f"Candidate proficiency level: {skill_level}"
        if performance_summary:
            level_info += f" ({performance_summary})"
        level_info += (
            ". Adapt your scaffolding depth, vocabulary, and pace to this level "
            "as instructed. Do not mention the level or these stats to the candidate.\n"
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
        f"{level_info}"
        f"[END INTERNAL CONTEXT]\n"
        f"{history_text}\n"
        f"Candidate's message: {question}\n\n"
        + mode_instructions(mode, student_answer is not None)
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
    skill_level: str | None = None,
    performance_summary: str | None = None,
    mode: str = "hint",
):
    """Stream tutor output for the requested mode, yielding content chunks.

    Before the candidate answers (student_answer is None) every mode's output
    passes through AnswerLeakGuard, so the correct option is never streamed
    regardless of what the model writes.
    """
    mode = normalize_mode(mode)
    if mode == "why_wrong" and (student_answer is None or student_answer == correct_option):
        mode = "hint"  # nothing to analyse; the web route already rejects this

    async def raw():
        if mock_llm_enabled():
            async for c in mock_tutor_stream(mode, options, correct_option, student_answer):
                yield c
            return
        prompt = _build_quiz_prompt(
            question, topic, subtopic, question_text, options,
            hint, solution_steps, correct_option, student_answer,
            history, skill_level, performance_summary, mode,
        )
        async for chunk in quiz_tutor_agent.arun(prompt, stream=True):
            if hasattr(chunk, "content") and chunk.content:
                yield chunk.content.replace("—", " - ")

    stream = raw()
    if student_answer is None:
        stream = AnswerLeakGuard(correct_option, options, question_text).guard(stream)
    async for chunk in stream:
        yield chunk
