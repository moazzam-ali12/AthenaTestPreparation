import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import {
  answerDailyQuestProblem,
  updateQuestStatus,
} from "@/lib/db/queries/daily-quest";
import {
  getSubsectionSkill,
  upsertSubsectionSkill,
  subjectToSectionCategory,
} from "@/lib/db/queries/subsection-skills";
import { updateSkillAfterAnswer } from "@/lib/adaptive/engine";
import { getAnswerReveal, toClientReveal } from "@/lib/db/queries/answer-keys";
import { checkOverallLevelUp } from "@/lib/adaptive/overall-level";
import { supabase } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import { NextResponse } from "next/server";
import { getFeatureTier } from "@/lib/subscription";
import { QUEST_COUNTS_TOWARD_MCQ_QUOTA } from "@/lib/trial";
import { trialLimitResponse } from "@/lib/trial-gate";
import { consumeTrialItem } from "@/lib/db/queries/trial";
import { isCpaSubject } from "@/types/cpa-exam";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // isCorrect / subtopicId / difficultyLevel in the body are ignored: they're
  // derived server-side from the quest row and the problem's answer key.
  const { questProblemId, selectedOption, responseTimeMs } = body as {
    questProblemId: string;
    selectedOption: number;
    responseTimeMs: number;
  };

  if (!questProblemId || typeof selectedOption !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data: questProblem } = (await (supabase as any)
    .from("daily_quest_problems")
    .select("id, quest_id, problem_id, subtopic_id, difficulty_level, is_correct, daily_quests!inner(user_id)")
    .eq("id", questProblemId)
    .eq("daily_quests.user_id", user.id)
    .maybeSingle()) as {
    data: {
      quest_id: string;
      problem_id: string;
      subtopic_id: string;
      difficulty_level: number;
      is_correct: boolean | null;
    } | null;
  };

  if (!questProblem) {
    return NextResponse.json({ error: "Quest problem not found" }, { status: 404 });
  }

  const answerKey = await getAnswerReveal(questProblem.problem_id);
  if (!answerKey) {
    return NextResponse.json({ error: "Problem not found" }, { status: 404 });
  }

  const isCorrect = selectedOption === answerKey.correctOption;
  const subtopicId = questProblem.subtopic_id;
  const difficultyLevel = questProblem.difficulty_level;
  // The quest UI lets candidates retry a missed question (with hints/tutor).
  // Only the first attempt is evidence of skill; retries update the row but
  // must not count as extra answers or earn XP.
  const isFirstAttempt = questProblem.is_correct === null;

  // Quest MCQs are free during the trial unless configured to draw on the
  // per-section MCQ quota (re-answering an already-consumed MCQ costs nothing).
  if (QUEST_COUNTS_TOWARD_MCQ_QUOTA && isFirstAttempt && getFeatureTier(user) === "trial") {
    const { data: sub } = await supabase
      .from("subtopics")
      .select("topics!inner(subject)")
      .eq("id", questProblem.subtopic_id)
      .maybeSingle();
    const subject = (sub?.topics as unknown as { subject: string } | undefined)?.subject;
    if (isCpaSubject(subject)) {
      const result = await consumeTrialItem(user.id, subject, "mcq", questProblem.problem_id);
      if (!result.allowed) return trialLimitResponse("mcq", subject);
    }
  }

  // Record the answer
  const updatedProblem = await answerDailyQuestProblem(
    questProblemId,
    selectedOption,
    isCorrect,
    responseTimeMs
  );

  // Mark quest as in_progress if it was pending (first answer = quest started)
  const { data: questRow } = (await supabase
    .from("daily_quests")
    .select("status")
    .eq("id", questProblem.quest_id)
    .maybeSingle()) as { data: { status: string } | null };
  await updateQuestStatus(questProblem.quest_id, "in_progress");
  if (questRow && questRow.status !== "in_progress" && questRow.status !== "completed") {
    track("quest_started", {}, user.id);
  }

  // Update subsection skills
  let xpEarned = 0;
  let overallLevelUp: number | null = null;
  if (isFirstAttempt) try {
    // Get section category for this subtopic
    const { data: subtopicData } = await supabase
      .from("subtopics")
      .select("id, topics!inner(subject)")
      .eq("id", subtopicId)
      .limit(1)
      .single();

    if (subtopicData) {
      const topic = subtopicData.topics as unknown as { subject: string };
      const sectionCategory = subjectToSectionCategory(topic?.subject ?? "aud");

      const skill = await getSubsectionSkill(user.id, subtopicId);
      if (skill) {
        const mutations = updateSkillAfterAnswer(
          skill,
          isCorrect,
          difficultyLevel
        );
        xpEarned = mutations.xp - skill.xp;

        await upsertSubsectionSkill(user.id, subtopicId, sectionCategory, {
          level: mutations.level,
          xp: mutations.xp,
          totalAttempts: mutations.totalAttempts,
          correctAttempts: mutations.correctAttempts,
          last10: mutations.last10,
          streakCorrect: mutations.streakCorrect,
          streakWrong: mutations.streakWrong,
          lastSeenAt: mutations.lastSeenAt,
        });

        // XP is accumulated and applied to totalXp at quest completion, not per-answer

        // Only a level-up can complete the last section, so skip the check otherwise.
        if (mutations.level > skill.level) {
          overallLevelUp = await checkOverallLevelUp(user.id);
        }
      }
    }
  } catch (e) {
    console.error("Failed to update subsection skills:", e);
  }

  return NextResponse.json({
    problem: updatedProblem,
    isCorrect,
    xpEarned,
    overallLevelUp,
    // Answered now, so this question's key, solution and hints may be shown.
    ...toClientReveal(answerKey),
  });
}
