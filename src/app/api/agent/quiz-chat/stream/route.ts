import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    question,
    topic,
    subtopic,
    questionText,
    options,
    hint,
    solutionSteps,
    correctOption,
    studentAnswer,
    history,
  } = body as {
    question: string;
    topic: string;
    subtopic: string;
    questionText: string;
    options: string[];
    hint: string;
    solutionSteps: { step: number; instruction: string; math: string }[];
    correctOption: number;
    studentAnswer?: number;
    history?: { role: string; content: string }[];
  };

  if (!question || !questionText) {
    return NextResponse.json(
      { error: "Question is required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${AGENT_URL}/quiz-chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        topic,
        subtopic,
        question_text: questionText,
        options,
        hint,
        solution_steps: solutionSteps,
        correct_option: correctOption,
        student_answer: studentAnswer ?? null,
        history: history ?? [],
      }),
    });

    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => "no body");
      console.error(`[agent/quiz-chat/stream] Agent returned ${res.status}:`, errorBody);
      throw new Error(`Agent service returned ${res.status}: ${errorBody}`);
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[agent/quiz-chat/stream] Error:", err);
    return NextResponse.json(
      { error: "AI tutor is currently unavailable. Please try again later." },
      { status: 503 }
    );
  }
}
