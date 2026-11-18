import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getAttemptById,
  upsertAnswer,
  updateAttemptPosition,
} from "@/lib/db/queries/cpa-exam";
import { getAnswerKeys } from "@/lib/db/queries/answer-keys";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await req.json();
  // isCorrect in the body is ignored — graded server-side below.
  const {
    attemptId,
    problemId,
    module,
    orderIndex,
    selectedOption,
    responseTimeMs,
  } = body as {
    attemptId: string;
    problemId: string;
    module: number;
    orderIndex: number;
    selectedOption: number;
    responseTimeMs?: number;
  };

  if (!attemptId || !problemId || module == null || orderIndex == null || typeof selectedOption !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const attempt = await getAttemptById(attemptId);
  if (!attempt || attempt.userId !== user.id) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  const answerKey = (await getAnswerKeys([problemId])).get(problemId);
  if (!answerKey) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }
  const isCorrect = selectedOption === answerKey.correctOption;

  await upsertAnswer(attemptId, {
    problemId,
    module,
    orderIndex,
    selectedOption,
    isCorrect,
    responseTimeMs,
  });

  await updateAttemptPosition(attemptId, {
    currentModule: module,
    currentQuestion: orderIndex,
  });

  return NextResponse.json({ ok: true });
}
