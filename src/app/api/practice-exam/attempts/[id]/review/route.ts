import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getAttemptAnswers,
  getAttemptById,
  getSubtopicNames,
  getTestProblems,
} from "@/lib/db/queries/cpa-exam";
import { buildAttemptReview, reviewAccess } from "@/lib/practice-exam";

/**
 * Per-question review (answer keys + explanations) for a SUBMITTED attempt.
 * Owner only (404); in-progress attempts get 403 ATTEMPT_NOT_SUBMITTED — this
 * is the boundary that keeps answer keys away from an unfinished exam.
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
  const attempt = await getAttemptById(id);

  // Gate before loading any answer keys.
  const denied = reviewAccess(attempt, user.id);
  if (denied?.status === 404) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  if (denied?.status === 403) {
    return NextResponse.json({ error: "Attempt not submitted yet", code: denied.code }, { status: 403 });
  }

  // Stored answer rows (question set + order) and the exam's problems with keys: two queries.
  const [answers, problems] = await Promise.all([
    getAttemptAnswers(attempt!.id),
    getTestProblems(attempt!.testId),
  ]);
  const subtopicNames = await getSubtopicNames(problems.map((p) => p.subtopicId));

  const result = buildAttemptReview(attempt!, user.id, answers, problems, subtopicNames);
  if (result.status !== 200) {
    return NextResponse.json({ error: "Attempt not found" }, { status: result.status });
  }
  return NextResponse.json(result.body);
}
