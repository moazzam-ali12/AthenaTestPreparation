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
import { supabase } from "@/lib/supabase/client";
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const {
    questProblemId,
    questId,
    selectedOption,
    isCorrect,
    responseTimeMs,
    subtopicId,
    difficultyLevel,
  } = body as {
    questProblemId: string;
    questId: string;
    selectedOption: number;
    isCorrect: boolean;
    responseTimeMs: number;
    subtopicId: string;
    difficultyLevel: number;
  };

  if (!questProblemId || selectedOption == null || isCorrect == null) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Record the answer
  const updatedProblem = await answerDailyQuestProblem(
    questProblemId,
    selectedOption,
    isCorrect,
    responseTimeMs
  );

  // Mark quest as in_progress if it was pending
  await updateQuestStatus(questId, "in_progress");

  // Update subsection skills
  let xpEarned = 0;
  try {
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
      }
    }
  } catch (e) {
    console.error("Failed to update subsection skills:", e);
  }

  return NextResponse.json({
    problem: updatedProblem,
    xpEarned,
  });
}
