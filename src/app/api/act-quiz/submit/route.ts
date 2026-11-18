import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { saveActQuizSession } from "@/lib/db/queries/act-quiz";
import { insertQuizQuestionEvents } from "@/lib/db/queries/tracking";
import {
  getSubsectionSkill,
  upsertSubsectionSkill,
  initializeAllSkills,
  subjectToSectionCategory,
} from "@/lib/db/queries/subsection-skills";
import { updateSkillAfterAnswer } from "@/lib/adaptive/engine";
import { getAnswerReveals, toClientReveal, type AnswerReveal } from "@/lib/db/queries/answer-keys";
import { checkOverallLevelUp } from "@/lib/adaptive/overall-level";
import { checkNewUnlocks } from "@/lib/gamification/check-unlocks";
import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";
import { getFeatureTier } from "@/lib/subscription";
import { getConsumedItemIds } from "@/lib/db/queries/trial";
import { trialLimitResponse } from "@/lib/trial-gate";

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
  const { subtopicId, totalQuestions, timeElapsedSeconds, answers: clientAnswers, events } =
    body as {
      subtopicId: string;
      score: number;
      totalQuestions: number;
      timeElapsedSeconds: number;
      answers: {
        problemId: string;
        selectedOption: number;
        isCorrect: boolean;
        responseTimeMs?: number;
        wrongCount?: number;
        hintUsed?: boolean;
        tutorUsed?: boolean;
        practiceCompleted?: boolean;
      }[];
      events?: {
        problemId: string;
        eventType: string;
        responseTimeMs?: number;
        selectedOption?: number;
        wrongCount?: number;
        practiceProblemId?: string;
        timestamp: string;
      }[];
    };

  if (
    !subtopicId ||
    !totalQuestions ||
    timeElapsedSeconds == null ||
    !Array.isArray(clientAnswers)
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Free trial: every answered MCQ must have been counted by
  // /api/act-quiz/answer. Unanswered ones (selectedOption -1) were never
  // counted and simply grade as wrong. Saving otherwise works as for Pro.
  const isTrial = getFeatureTier(user) !== "pro";
  const consumed = isTrial ? await getConsumedItemIds(user.id, "mcq") : null;
  if (consumed && clientAnswers.some((a) => a.selectedOption >= 0 && !consumed.has(a.problemId))) {
    return trialLimitResponse("mcq", null);
  }

  // Re-grade against the server's answer keys: the client's isCorrect and
  // score can't be trusted (score gates curriculum unlocks). A question only
  // counts as correct on a clean first try, matching the quiz UI's rule.
  const answerKeys = await getAnswerReveals(clientAnswers.map((a) => a.problemId));
  const answers = clientAnswers
    .filter((a) => answerKeys.has(a.problemId))
    .map((a) => ({
      ...a,
      isCorrect:
        a.selectedOption === answerKeys.get(a.problemId)!.correctOption &&
        (a.wrongCount ?? 0) === 0,
    }));
  const score = answers.filter((a) => a.isCorrect).length;

  const session = await saveActQuizSession({
    userId: user.id,
    subtopicId,
    score,
    totalQuestions,
    timeElapsedSeconds,
    answers,
  });

  if (events && events.length > 0) {
    try {
      await insertQuizQuestionEvents(
        events.map((e) => ({
          sessionId: session.id,
          problemId: e.problemId,
          userId: user.id,
          eventType: e.eventType,
          responseTimeMs: e.responseTimeMs,
          selectedOption: e.selectedOption,
          wrongCount: e.wrongCount,
          practiceProblemId: e.practiceProblemId,
          timestamp: e.timestamp,
        }))
      );
    } catch (e) {
      console.error("Failed to save quiz question events:", e);
    }
  }

  let xpEarned = 0;
  let overallLevelUp: number | null = null;
  try {
    const { data: subtopicData } = await supabase
      .from("subtopics")
      .select("id, topics!inner(subject)")
      .eq("id", subtopicId)
      .limit(1)
      .single();

    if (subtopicData) {
      const topic = subtopicData.topics as unknown as { subject: string };
      const sectionCategory = subjectToSectionCategory(topic?.subject ?? "aud");

      let skill = await getSubsectionSkill(user.id, subtopicId);
      if (!skill) {
        await initializeAllSkills(user.id);
        skill = await getSubsectionSkill(user.id, subtopicId);
      }

      if (skill) {
        let currentSkill = skill;
        let totalXpEarned = 0;

        for (const answer of answers) {
          const diffLevel = answerKeys.get(answer.problemId)!.difficultyLevel;
          const mutations = updateSkillAfterAnswer(
            currentSkill,
            answer.isCorrect,
            diffLevel
          );
          totalXpEarned += mutations.xp - currentSkill.xp;
          currentSkill = { ...currentSkill, ...mutations };
        }

        await upsertSubsectionSkill(user.id, subtopicId, sectionCategory, {
          level: currentSkill.level,
          xp: currentSkill.xp,
          totalAttempts: currentSkill.totalAttempts,
          correctAttempts: currentSkill.correctAttempts,
          last10: currentSkill.last10,
          streakCorrect: currentSkill.streakCorrect,
          streakWrong: currentSkill.streakWrong,
          lastSeenAt: new Date().toISOString(),
        });

        if (totalXpEarned > 0) {
          xpEarned = totalXpEarned;
          await updateUser(clerkId, {
            totalXp: (user.totalXp ?? 0) + totalXpEarned,
          });
        }

        if (currentSkill.level > skill.level) {
          overallLevelUp = await checkOverallLevelUp(user.id);
        }
      }
    }
  } catch (e) {
    console.error("Failed to update subsection skills:", e);
  }

  // Streak: a quiz doesn't make a day count (only a completed daily quest does,
  // via recordStreakDay), so nothing to write here.

  const xpBefore = user.totalXp ?? 0;
  const { newBadges, rankUp } = await checkNewUnlocks(user.id, xpBefore, xpBefore + xpEarned);

  // The quiz is over: reveal every question for the review screen — for trial
  // users only the counted ones (skipped MCQs stay unseen and uncounted).
  const reveals: Record<string, AnswerReveal> = {};
  for (const [id, key] of answerKeys) {
    if (!consumed || consumed.has(id)) reveals[id] = toClientReveal(key);
  }

  return NextResponse.json({ sessionId: session.id, score, newBadges, rankUp, overallLevelUp, reveals });
}
