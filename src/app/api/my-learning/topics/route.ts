import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  saveCustomTopic,
  getUserCustomTopics,
} from "@/lib/db/queries/custom-learning";

export const maxDuration = 60;

const AGENT_URL =
  process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const topics = await getUserCustomTopics(user.id);
  return NextResponse.json({ topics });
}

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { topic } = (await req.json()) as { topic: string };
  if (!topic?.trim()) {
    return NextResponse.json({ error: "Topic is required" }, { status: 400 });
  }

  const agentRes = await fetch(`${AGENT_URL}/my-learning/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });

  if (!agentRes.ok) {
    return NextResponse.json(
      { error: "Failed to generate topic" },
      { status: 502 }
    );
  }

  const generated = (await agentRes.json()) as {
    description: string;
    learningObjectives: string[];
    tipsAndTricks: string[];
    commonMistakes: { mistake: string; correction: string; why: string }[];
    questions: {
      orderIndex: number;
      difficulty: string;
      questionText: string;
      options: string[];
      correctOption: number;
      explanation: string;
      solutionSteps: { step: number; instruction: string; math: string }[];
      hint: string;
      timeRecommendationSeconds: number;
    }[];
  };

  const saved = await saveCustomTopic({
    userId: user.id,
    title: topic,
    description: generated.description,
    learningObjectives: generated.learningObjectives,
    tipsAndTricks: generated.tipsAndTricks,
    commonMistakes: generated.commonMistakes,
    questions: generated.questions,
  });

  return NextResponse.json({ topicId: saved.id });
}
