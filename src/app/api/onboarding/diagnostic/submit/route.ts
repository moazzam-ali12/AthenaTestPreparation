import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { supabase } from "@/lib/supabase/client";
import { upsertOnboardingProgress } from "@/lib/db/queries/onboarding";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import { NextResponse } from "next/server";
import { z } from "zod";

const AnswerSchema = z.object({
  problemId: z.string(),
  section: z.enum(CPA_CORE_SECTIONS as [string, ...string[]]),
  selectedOption: z.number(),
});

const BodySchema = z.object({
  answers: z.array(AnswerSchema),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { answers } = body;

  // Fetch correct options for all submitted problems
  const problemIds = answers.map((a) => a.problemId);
  const { data: problems } = await supabase
    .from("problems")
    .select("id, correct_option")
    .in("id", problemIds);

  const correctMap = new Map((problems ?? []).map((p) => [p.id, p.correct_option]));

  // Calculate per-section accuracy (informational only — this is a diagnostic
  // quiz, not a graded exam, so we don't fabricate CPA scaled scores from it)
  const sectionStats: Record<string, { correct: number; total: number }> =
    Object.fromEntries(CPA_CORE_SECTIONS.map((s) => [s, { correct: 0, total: 0 }]));

  for (const answer of answers) {
    const correctOption = correctMap.get(answer.problemId);
    if (correctOption == null) continue;
    sectionStats[answer.section].total++;
    if (answer.selectedOption === correctOption) {
      sectionStats[answer.section].correct++;
    }
  }

  const correctCount = Object.values(sectionStats).reduce((sum, s) => sum + s.correct, 0);
  const totalQuestions = Object.values(sectionStats).reduce((sum, s) => sum + s.total, 0);
  const skillScore = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  // skill_score is an exam-agnostic column — safe to keep updating as a
  // rough overall accuracy signal from the diagnostic.
  await supabase
    .from("users")
    .update({ skill_score: skillScore })
    .eq("id", user.id);

  await upsertOnboardingProgress(user.id, { currentStep: "schedule" });

  return NextResponse.json({
    correctCount,
    totalQuestions,
    skillScore,
  });
}
