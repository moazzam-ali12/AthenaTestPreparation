import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { supabase } from "@/lib/supabase/client";
import { upsertOnboardingProgress } from "@/lib/db/queries/onboarding";
import { initializeAllSkills } from "@/lib/db/queries/subsection-skills";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import { track } from "@/lib/analytics";
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

const MAX_DIAGNOSTIC_START_LEVEL = 4;

/** 100% → level 4, 75% → 3, 50% → 2, below → 1 (on the 4-question diagnostic). */
function diagnosticStartLevel(correct: number, total: number): number {
  const level = 1 + Math.floor((correct / total) * (MAX_DIAGNOSTIC_START_LEVEL - 1) + 0.0001);
  return Math.max(1, Math.min(MAX_DIAGNOSTIC_START_LEVEL, level));
}

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

  // Seed each core section's starting skill level from the diagnostic so a
  // strong candidate doesn't have to climb through easy questions first.
  // Four questions is thin evidence, so the seed is capped at level 4 (the
  // bottom of the medium band) and only touches subtopics never practiced.
  try {
    await initializeAllSkills(user.id);
    for (const section of CPA_CORE_SECTIONS) {
      const { correct, total } = sectionStats[section];
      if (total === 0) continue;
      const startLevel = diagnosticStartLevel(correct, total);
      if (startLevel <= 1) continue;
      await (supabase as any)
        .from("subsection_skills")
        .update({ level: startLevel, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("section_category", section)
        .eq("total_attempts", 0);
    }
  } catch (e) {
    console.error("Failed to seed skill levels from diagnostic:", e);
  }

  await upsertOnboardingProgress(user.id, { currentStep: "schedule" });
  track("diagnostic_done", { correct: correctCount, total: totalQuestions }, user.id);

  return NextResponse.json({
    correctCount,
    totalQuestions,
    skillScore,
  });
}
