import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { customQuestionReveal, getCustomTopicWithQuestions } from "@/lib/db/queries/custom-learning";

/**
 * Grades ONE custom-topic quiz answer and only then reveals that question's
 * key, explanation, solution steps and hint. Owner-only (the topic lookup is
 * scoped to the user). No trial quota: /api/my-learning is Pro-only.
 */
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { topicId?: unknown; questionId?: unknown; selectedOption?: unknown }
    | null;
  const { topicId, questionId, selectedOption } = body ?? {};
  if (typeof topicId !== "string" || typeof questionId !== "string" || typeof selectedOption !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await getCustomTopicWithQuestions(topicId, user.id);
  const question = result?.questions.find((q) => q.id === questionId);
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const reveal = customQuestionReveal(question);
  return NextResponse.json({ isCorrect: selectedOption === reveal.correctOption, ...reveal, optionHints: [] });
}
