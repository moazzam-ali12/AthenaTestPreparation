import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  upsertAnswer,
  updateAttemptPosition,
} from "@/lib/db/queries/cpa-exam";
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
  const {
    attemptId,
    problemId,
    module,
    orderIndex,
    selectedOption,
    isCorrect,
    responseTimeMs,
  } = body as {
    attemptId: string;
    problemId: string;
    module: number;
    orderIndex: number;
    selectedOption: number;
    isCorrect: boolean;
    responseTimeMs?: number;
  };

  if (!attemptId || !problemId || module == null || orderIndex == null || selectedOption == null || isCorrect == null) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

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
