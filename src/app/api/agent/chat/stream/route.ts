import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { question, lessonTitle, lessonContent } = body as {
    question: string;
    lessonTitle: string;
    lessonContent: string;
  };

  if (!question || !lessonTitle) {
    return NextResponse.json(
      { error: "Question and lesson title are required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${AGENT_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        lesson_title: lessonTitle,
        lesson_content: lessonContent,
      }),
    });

    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => "no body");
      console.error(`[agent/chat/stream] Agent returned ${res.status}:`, errorBody);
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
    console.error("[agent/chat/stream] Error:", err);
    return NextResponse.json(
      { error: "AI tutor is currently unavailable. Please try again later." },
      { status: 503 }
    );
  }
}
