import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCustomTopicWithQuestions, redactCustomQuestion } from "@/lib/db/queries/custom-learning";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { topicId } = await params;
  const result = await getCustomTopicWithQuestions(topicId, user.id);

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // No answers before answering: POST /api/my-learning/quiz/answer reveals them per question.
  return NextResponse.json({ topic: result.topic, questions: result.questions.map(redactCustomQuestion) });
}
