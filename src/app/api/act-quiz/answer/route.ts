import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getAnswerReveal, toClientReveal } from "@/lib/db/queries/answer-keys";
import { getCurriculumLockMap } from "@/lib/db/queries/next-lesson";
import { consumeTrialItem } from "@/lib/db/queries/trial";
import { getFeatureTier } from "@/lib/subscription";
import { trialLimitResponse } from "@/lib/trial-gate";
import { isCpaSubject } from "@/types/cpa-exam";

/**
 * Grades ONE subtopic-quiz answer and only then reveals that question's key,
 * explanation, solution steps and hints. The quiz payload never carries them.
 *
 * Free trial: the first answer to a new MCQ consumes one unit of the
 * per-section quota; re-answering an already-counted MCQ is free. Nothing is
 * saved here — the quiz still persists its results via /api/act-quiz/submit.
 */
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { problemId?: unknown; selectedOption?: unknown } | null;
  const problemId = body?.problemId;
  const selectedOption = body?.selectedOption;
  if (typeof problemId !== "string" || typeof selectedOption !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: problem } = (await (supabase as any)
    .from("problems")
    .select("source, subtopic_id, subtopics!inner(topics!inner(subject))")
    .eq("id", problemId)
    .maybeSingle()) as {
    data: { source: string; subtopic_id: string; subtopics: { topics: { subject: string } } } | null;
  };
  if (!problem || problem.source !== "cpa") {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  // Same gate as the quiz payload: no answers for locked subtopics.
  const lockMap = await getCurriculumLockMap(user.id, user.targetDisciplineSection);
  if (lockMap.get(problem.subtopic_id) ?? true) {
    return NextResponse.json(
      { error: "Complete the earlier subtopics in your curriculum first." },
      { status: 403 }
    );
  }

  if (getFeatureTier(user) !== "pro") {
    const section = problem.subtopics.topics.subject;
    if (!isCpaSubject(section)) return trialLimitResponse("mcq", null);
    const result = await consumeTrialItem(user.id, section, "mcq", problemId);
    if (!result.allowed) return trialLimitResponse("mcq", section);
  }

  const reveal = await getAnswerReveal(problemId);
  if (!reveal) return NextResponse.json({ error: "Problem not found" }, { status: 404 });

  return NextResponse.json({
    isCorrect: selectedOption === reveal.correctOption,
    ...toClientReveal(reveal),
  });
}
