import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { completeAttempt, getTbsAnswerKey } from "@/lib/db/queries/tbs";
import {
  getSubsectionSkill,
  initializeAllSkills,
  subjectToSectionCategory,
  upsertSubsectionSkill,
} from "@/lib/db/queries/subsection-skills";
import { DIFFICULTY_TIER_LEVELS, updateSkillAfterAnswer } from "@/lib/adaptive/engine";
import { checkOverallLevelUp } from "@/lib/adaptive/overall-level";
import { gradeTbs } from "@/lib/tbs/grade";
import { attemptBodySchema, loadTaskAndAttempt, pickTaskResponses } from "@/lib/tbs/server";
import { TBS_PASS_PERCENT, type TbsSubmitResponse } from "@/lib/tbs/schema";

/**
 * POST /api/tbs/[id]/submit — grades server-side against the stored key and
 * only then reveals correct answers and the explanation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const parsed = attemptBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await params;
  const loaded = await loadTaskAndAttempt(user, id);
  if (loaded instanceof NextResponse) return loaded;
  const { task, attempt } = loaded;

  const key = await getTbsAnswerKey(task.id);
  if (!key) {
    console.error(`tbs ${task.id} has no valid answer key`);
    return NextResponse.json({ error: "This simulation can't be graded right now" }, { status: 500 });
  }

  const responses = pickTaskResponses(task, parsed.data.responses);
  const graded = gradeTbs(task.fields, key, responses);
  const stored = await completeAttempt(attempt.id, {
    responses,
    timeSpentSeconds: parsed.data.timeSpentSeconds,
    score: graded.score,
    maxScore: graded.maxScore,
    fieldResults: graded.fieldResults,
  });
  if (!stored) return NextResponse.json({ error: "Already submitted" }, { status: 409 });

  const passed = graded.percent >= TBS_PASS_PERCENT;

  // Adaptive engine: one TBS counts as one answer at the task's difficulty,
  // correct when it scores >= TBS_PASS_PERCENT. Level-up rules are unchanged.
  let xpEarned = 0;
  let overallLevelUp: number | null = null;
  if (task.subtopicId) {
    try {
      let skill = await getSubsectionSkill(user.id, task.subtopicId);
      if (!skill) {
        await initializeAllSkills(user.id);
        skill = await getSubsectionSkill(user.id, task.subtopicId);
      }
      if (skill) {
        const mutations = updateSkillAfterAnswer(skill, passed, DIFFICULTY_TIER_LEVELS[task.difficulty]);
        await upsertSubsectionSkill(user.id, task.subtopicId, subjectToSectionCategory(task.section), {
          level: mutations.level,
          xp: mutations.xp,
          totalAttempts: mutations.totalAttempts,
          correctAttempts: mutations.correctAttempts,
          last10: mutations.last10,
          streakCorrect: mutations.streakCorrect,
          streakWrong: mutations.streakWrong,
          lastSeenAt: new Date().toISOString(),
        });
        xpEarned = Math.max(0, mutations.xp - skill.xp);
        if (xpEarned > 0) await updateUser(clerkId, { totalXp: (user.totalXp ?? 0) + xpEarned });
        if (mutations.level > skill.level) overallLevelUp = await checkOverallLevelUp(user.id);
      }
    } catch (e) {
      console.error("Failed to update subsection skill after TBS:", e);
    }
  }

  const body: TbsSubmitResponse = {
    score: graded.score,
    maxScore: graded.maxScore,
    percent: graded.percent,
    passed,
    fieldResults: graded.fieldResults,
    explanation: task.explanation,
    xpEarned,
    overallLevelUp,
  };
  return NextResponse.json(body);
}
