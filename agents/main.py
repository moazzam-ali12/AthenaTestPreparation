"""
Athena AI Agent service — FastAPI server for lesson generation and tutoring.

The tutor agents control the whiteboard directly — their responses can
include a <<<WHITEBOARD>>> delimiter followed by JSON Lines whiteboard steps.
This server parses the mixed format and sends separate SSE events for text
tokens and whiteboard steps.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from app.run_time.act.tutoring_agent import ask_tutor_stream
from app.run_time.act.quiz_tutor_agent import ask_quiz_tutor_stream
from app.run_time.act.mentor_agent import ask_mentor_stream
from app.run_time.act.micro_lesson_agent import generate_micro_lesson_stream, micro_lesson_chat_stream
from app.run_time.act.why_this_matters_agent import generate_why_stream
from app.run_time.dynamic.my_learning_generator import generate_my_learning_content
from app.run_time.dynamic.my_learning_lesson_agent import generate_my_learning_lesson_stream, my_learning_lesson_chat_stream
from app.run_time.dynamic.my_learning_quiz_tutor_agent import ask_my_learning_quiz_tutor_stream
from app.pre_generation.problem_generator import generate_problems_batch

load_dotenv(Path(__file__).parent / ".env")

from app.cron.session_reminders import session_reminder_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(session_reminder_loop())
    yield
    task.cancel()


app = FastAPI(title="Athena Agents", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WHITEBOARD_DELIMITER = "<<<WHITEBOARD>>>"


class ChatRequest(BaseModel):
    question: str
    lesson_title: str
    lesson_content: str


class MentorChatMessage(BaseModel):
    role: str
    content: str


class MentorChatRequest(BaseModel):
    question: str
    history: list[MentorChatMessage] = []
    student_context: dict = {}


class QuizChatMessage(BaseModel):
    role: str
    content: str


class QuizChatRequest(BaseModel):
    question: str
    topic: str
    subtopic: str
    question_text: str
    options: list[str]
    hint: str
    solution_steps: list[dict]
    correct_option: int
    student_answer: int | None = None
    history: list[QuizChatMessage] = []


async def stream_with_whiteboard(
    raw_stream: AsyncGenerator[str, None],
) -> AsyncGenerator[str, None]:
    """Parse a tutor's mixed text+whiteboard stream into separate SSE events.

    Before <<<WHITEBOARD>>>: emit {"token": "..."} events.
    After <<<WHITEBOARD>>>: emit {"wb_step": {...}} events for each JSON object.

    Handles the delimiter being split across multiple chunks, and handles
    multiple JSON objects on a single line (brace-depth parsing).
    """
    state = "text"
    buffer = ""
    step_id_counter = 0

    async for chunk in raw_stream:
        if state == "text":
            buffer += chunk

            if WHITEBOARD_DELIMITER in buffer:
                before, after = buffer.split(WHITEBOARD_DELIMITER, 1)
                # Flush any text before the delimiter
                text_to_send = before.rstrip("\n")
                if text_to_send:
                    yield f"data: {json.dumps({'token': text_to_send})}\n\n"
                state = "whiteboard"
                buffer = after
                # Try to extract any complete JSON objects already in the buffer
                for step in _extract_steps(buffer):
                    step["id"] = step_id_counter
                    step_id_counter += 1
                    yield f"data: {json.dumps({'wb_step': step})}\n\n"
                buffer = _remaining_after_extraction(buffer)
            else:
                # Hold back any suffix that could be the start of <<<WHITEBOARD>>>
                # Must find the LONGEST matching prefix, not the shortest.
                hold_back = 0
                for i in range(1, min(len(WHITEBOARD_DELIMITER), len(buffer) + 1)):
                    if buffer.endswith(WHITEBOARD_DELIMITER[:i]):
                        hold_back = i
                # Do NOT break — keep checking for longer prefixes

                safe_end = len(buffer) - hold_back
                if safe_end > 0:
                    flush = buffer[:safe_end]
                    buffer = buffer[safe_end:]
                    yield f"data: {json.dumps({'token': flush})}\n\n"
        else:
            # Whiteboard mode — extract complete JSON objects
            buffer += chunk
            for step in _extract_steps(buffer):
                step["id"] = step_id_counter
                step_id_counter += 1
                yield f"data: {json.dumps({'wb_step': step})}\n\n"
            buffer = _remaining_after_extraction(buffer)

    # Flush remaining buffer
    if state == "text" and buffer.strip():
        if WHITEBOARD_DELIMITER in buffer:
            before, after = buffer.split(WHITEBOARD_DELIMITER, 1)
            if before.strip():
                yield f"data: {json.dumps({'token': before.rstrip()})}\n\n"
            for step in _extract_steps(after):
                step["id"] = step_id_counter
                step_id_counter += 1
                yield f"data: {json.dumps({'wb_step': step})}\n\n"
        else:
            yield f"data: {json.dumps({'token': buffer})}\n\n"
    elif state == "whiteboard" and buffer.strip():
        for step in _extract_steps(buffer):
            step["id"] = step_id_counter
            step_id_counter += 1
            yield f"data: {json.dumps({'wb_step': step})}\n\n"

    yield "data: [DONE]\n\n"


def _extract_steps(text: str) -> list[dict]:
    """Extract all complete JSON objects from text using brace-depth tracking.

    Handles multiple objects on one line, objects split across lines, etc.
    Returns a list of parsed step dicts.
    """
    steps = []
    depth = 0
    start = -1

    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = text[start : i + 1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict) and "action" in obj:
                        obj.setdefault("durationMs", 800)
                        obj.setdefault("delayMs", 200)
                        steps.append(obj)
                except json.JSONDecodeError:
                    pass
                start = -1

    return steps


def _remaining_after_extraction(text: str) -> str:
    """Return the trailing portion of text after the last complete JSON object.

    If there's an incomplete object at the end (open brace without matching
    close), returns from that opening brace onward so the next chunk can
    complete it.
    """
    depth = 0
    last_complete_end = -1

    for i, ch in enumerate(text):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                last_complete_end = i + 1

    if last_complete_end >= 0:
        return text[last_complete_end:]
    # No complete objects found — keep entire buffer (might be partial)
    # But strip leading whitespace/newlines since they're not useful
    stripped = text.lstrip(" \t\n")
    if "{" in stripped:
        return stripped
    return ""


@app.post("/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    async def event_generator():
        try:
            raw = ask_tutor_stream(
                question=req.question,
                lesson_title=req.lesson_title,
                lesson_content=req.lesson_content,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/mentor-chat/stream")
async def mentor_chat_stream_endpoint(req: MentorChatRequest):
    history = [m.model_dump() for m in req.history] if req.history else None

    async def event_generator():
        try:
            raw = ask_mentor_stream(
                question=req.question,
                student_context=req.student_context,
                history=history,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/quiz-chat/stream")
async def quiz_chat_stream_endpoint(req: QuizChatRequest):
    history = [m.model_dump() for m in req.history] if req.history else None

    async def event_generator():
        try:
            raw = ask_quiz_tutor_stream(
                question=req.question,
                topic=req.topic,
                subtopic=req.subtopic,
                question_text=req.question_text,
                options=req.options,
                hint=req.hint,
                solution_steps=req.solution_steps,
                correct_option=req.correct_option,
                student_answer=req.student_answer,
                history=history,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class MicroLessonKeyFormula(BaseModel):
    latex: str = ""
    description: str = ""


class MicroLessonCommonMistake(BaseModel):
    mistake: str = ""
    correction: str = ""
    why: str = ""


class MicroLessonConceptualOverview(BaseModel):
    definition: str = ""
    real_world_example: str = ""
    act_context: str = ""


class MicroLessonRequest(BaseModel):
    topic: str
    subtopic: str
    description: str = ""
    learning_objectives: list[str] = []
    key_formulas: list[MicroLessonKeyFormula] = []
    common_mistakes: list[MicroLessonCommonMistake] = []
    tips_and_tricks: list[str] = []
    conceptual_overview: MicroLessonConceptualOverview | None = None


class MicroLessonChatMessage(BaseModel):
    role: str
    content: str


class MicroLessonChatRequest(BaseModel):
    question: str
    topic: str
    subtopic: str
    lesson_summary: str
    lesson_steps: list[dict] = []
    metadata: dict = {}
    current_step_index: int = 0
    history: list[MicroLessonChatMessage] = []


@app.post("/micro-lesson/stream")
async def micro_lesson_stream_endpoint(req: MicroLessonRequest):
    metadata = {
        "description": req.description,
        "learning_objectives": req.learning_objectives,
        "key_formulas": [f.model_dump() for f in req.key_formulas],
        "common_mistakes": [m.model_dump() for m in req.common_mistakes],
        "tips_and_tricks": req.tips_and_tricks,
        "conceptual_overview": req.conceptual_overview.model_dump() if req.conceptual_overview else None,
    }

    async def event_generator():
        try:
            raw = generate_micro_lesson_stream(
                topic=req.topic,
                subtopic=req.subtopic,
                subtopic_metadata=metadata,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/why-this-matters/stream")
async def why_this_matters_stream_endpoint(req: MicroLessonRequest):
    metadata = {
        "description": req.description,
        "learning_objectives": req.learning_objectives,
        "key_formulas": [f.model_dump() for f in req.key_formulas],
        "common_mistakes": [m.model_dump() for m in req.common_mistakes],
        "tips_and_tricks": req.tips_and_tricks,
        "conceptual_overview": req.conceptual_overview.model_dump() if req.conceptual_overview else None,
    }

    async def event_generator():
        try:
            raw = generate_why_stream(
                topic=req.topic,
                subtopic=req.subtopic,
                subtopic_metadata=metadata,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/micro-lesson/chat/stream")
async def micro_lesson_chat_stream_endpoint(req: MicroLessonChatRequest):
    history = [m.model_dump() for m in req.history] if req.history else None

    async def event_generator():
        try:
            raw = micro_lesson_chat_stream(
                question=req.question,
                topic=req.topic,
                subtopic=req.subtopic,
                lesson_summary=req.lesson_summary,
                lesson_steps=req.lesson_steps or None,
                metadata=req.metadata or None,
                current_step_index=req.current_step_index,
                history=history,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class MyLearningRequest(BaseModel):
    topic: str


@app.post("/my-learning/lesson/stream")
async def my_learning_lesson_stream_endpoint(req: MicroLessonRequest):
    metadata = {
        "description": req.description,
        "learning_objectives": req.learning_objectives,
        "common_mistakes": [m.model_dump() for m in req.common_mistakes],
        "tips_and_tricks": req.tips_and_tricks,
    }

    async def event_generator():
        try:
            raw = generate_my_learning_lesson_stream(
                topic=req.topic,
                subtopic=req.subtopic,
                metadata=metadata,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/my-learning/lesson/chat/stream")
async def my_learning_lesson_chat_stream_endpoint(req: MicroLessonChatRequest):
    history = [m.model_dump() for m in req.history] if req.history else None

    async def event_generator():
        try:
            raw = my_learning_lesson_chat_stream(
                question=req.question,
                topic=req.topic,
                subtopic=req.subtopic,
                lesson_summary=req.lesson_summary,
                history=history,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/my-learning/quiz-chat/stream")
async def my_learning_quiz_chat_stream_endpoint(req: QuizChatRequest):
    history = [m.model_dump() for m in req.history] if req.history else None

    async def event_generator():
        try:
            raw = ask_my_learning_quiz_tutor_stream(
                question=req.question,
                topic=req.topic,
                subtopic=req.subtopic,
                question_text=req.question_text,
                options=req.options,
                hint=req.hint,
                solution_steps=req.solution_steps,
                correct_option=req.correct_option,
                student_answer=req.student_answer,
                history=history,
            )
            async for event in stream_with_whiteboard(raw):
                yield event
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/my-learning/generate")
async def my_learning_generate_endpoint(req: MyLearningRequest):
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="Topic is required")
    try:
        result = await generate_my_learning_content(req.topic)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class PracticeProblemsRequest(BaseModel):
    topic: str
    subtopic: str
    subject: str = "math"


@app.post("/practice-problems")
async def practice_problems_endpoint(req: PracticeProblemsRequest):
    try:
        import random
        difficulty = random.choice(["easy", "medium", "hard"])
        problems = await generate_problems_batch(
            subtopic_name=req.subtopic,
            topic_name=req.topic,
            subtopic_id="practice",
            batch_number=0,
            difficulty=difficulty,
            batch_size=2,
            subject=req.subject,
        )
        return {"problems": [
            {
                "id": f"practice-{i}",
                "questionText": p["question_text"],
                "options": p["options"],
                "correctOption": p["correct_option"],
                "hint": p["hint"],
                "detailedHint": p.get("detailed_hint", ""),
                "solutionSteps": p["solution_steps"],
                "explanation": p["explanation"],
                "difficulty": p["difficulty"],
                "orderIndex": i,
                "timeRecommendationSeconds": 90,
            }
            for i, p in enumerate(problems)
        ]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class LessonSummaryKeyFormula(BaseModel):
    latex: str = ""
    description: str = ""


class LessonSummaryScore(BaseModel):
    correct: int
    total: int


class LessonSummaryRequest(BaseModel):
    topic_name: str
    subtopic_name: str
    lesson_type: str
    score: LessonSummaryScore | None = None
    learning_objectives: list[str] = []
    key_formulas: list[LessonSummaryKeyFormula] = []


@app.post("/lesson-summary")
async def lesson_summary_endpoint(req: LessonSummaryRequest):
    import anthropic

    score_context = (
        f"\nThe student scored {req.score.correct}/{req.score.total} on the practice problems."
        if req.score
        else ""
    )
    objectives_context = (
        f"\nLearning objectives covered: {'; '.join(req.learning_objectives)}"
        if req.learning_objectives
        else ""
    )
    formulas_context = (
        f"\nKey formulas used: {'; '.join(f.description for f in req.key_formulas)}"
        if req.key_formulas
        else ""
    )

    prompt = f"""You are Athena, a warm and encouraging AI tutor. A student just completed a {req.lesson_type} on "{req.subtopic_name}" (part of {req.topic_name}).{score_context}{objectives_context}{formulas_context}

Generate a short, personal congratulatory message as JSON with these fields:
- greeting: a short celebratory phrase (3-6 words), e.g. "You did it!" or "Nicely done!"
- summary: 1-2 sentences about what they learned today, referencing the topic specifically. Address the student as "you".
- takeaways: an array of 2-3 concise bullet points of key concepts they covered
- encouragement: a single motivational closing line

If a score was provided, reference it naturally. Keep total text under 100 words. Be warm but not over-the-top.

Respond with ONLY valid JSON, no markdown fences."""

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )

    try:
        result = json.loads(message.content[0].text)
        return result
    except (json.JSONDecodeError, IndexError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
