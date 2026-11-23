import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getAttemptAnswers,
  getAttemptById,
  getTestById,
  getTestProblems,
} from "@/lib/db/queries/cpa-exam";
import {
  attemptElapsedSeconds,
  examDurationMinutes,
  ownedAttempt,
  redactProblem,
} from "@/lib/practice-exam";
import type { CpaExamAttemptResponse } from "@/types/cpa-exam";

/**
 * Loads one attempt by ID for the attempt/results pages, so a refresh never
 * re-runs /start (no new attempt, no trial quota). Owner only; anything else is 404.
 * Uses the service-role client, so the user_id check below is the access control.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { id } = await params;
  const attempt = ownedAttempt(await getAttemptById(id), user.id);
  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  const inProgress = attempt.status === "in_progress";
  const [test, answers, allProblems] = await Promise.all([
    getTestById(attempt.testId),
    getAttemptAnswers(attempt.id),
    getTestProblems(attempt.testId),
  ]);

  // The attempt's answer rows define its question set (a sample is a 15-question slice).
  const answerKeys = new Set(answers.map((a) => `${a.module}:${a.orderIndex}`));
  const problems = allProblems.filter((p) => answerKeys.has(`${p.module}:${p.orderIndex}`));
  const durationMinutes = examDurationMinutes(attempt);

  const response: CpaExamAttemptResponse = {
    attempt,
    test: test ?? {
      id: attempt.testId,
      section: attempt.section,
      testNumber: 0,
      name: "",
      status: "active",
      createdAt: "",
    },
    problems: inProgress ? problems.map(redactProblem) : problems,
    answers: inProgress ? answers.map((a) => ({ ...a, isCorrect: null })) : answers,
    isSample: attempt.isSample,
    durationMinutes,
    startedAt: attempt.startedAt,
    submittedAt: attempt.completedAt,
    elapsedSeconds: inProgress
      ? attemptElapsedSeconds(attempt.startedAt, durationMinutes)
      : attempt.totalTimeSeconds,
    scaledScore: attempt.scaledScore,
    rawScore: attempt.rawScore,
    total: answers.length,
    passed: attempt.isSample || inProgress ? null : attempt.passed,
  };

  return NextResponse.json(response);
}
