import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const {
    topicName,
    subtopicName,
    lessonType,
    score,
    learningObjectives,
    keyFormulas,
  } = (await req.json()) as {
    topicName: string;
    subtopicName: string;
    lessonType: "micro-lesson" | "quiz";
    score?: { correct: number; total: number };
    learningObjectives?: string[];
    keyFormulas?: { latex: string; description: string }[];
  };

  try {
    const res = await fetch(`${AGENT_URL}/lesson-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic_name: topicName,
        subtopic_name: subtopicName,
        lesson_type: lessonType,
        score: score || null,
        learning_objectives: learningObjectives || [],
        key_formulas: keyFormulas || [],
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "no body");
      console.error(
        `[lesson-summary] Agent returned ${res.status}:`,
        errorBody
      );
      throw new Error(`Agent service returned ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    console.error("[lesson-summary] Error:", err);
    return NextResponse.json(
      { error: "Failed to generate lesson summary. Please try again later." },
      { status: 503 }
    );
  }
}
