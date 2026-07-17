import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import {
  getAttemptAnswers,
  getAttemptById,
  completeAttempt,
  getTestProblems,
  upsertSectionProgressAfterAttempt,
} from "@/lib/db/queries/cpa-exam";
import {
  getSubsectionSkill,
  upsertSubsectionSkill,
  initializeAllSkills,
} from "@/lib/db/queries/subsection-skills";
import { updateSkillAfterAnswer } from "@/lib/adaptive/engine";
import { computeSectionExamScore } from "@/lib/cpa-scoring";
import { NextResponse } from "next/server";
import type { SectionCategory } from "@/types/adaptive";
import type { CpaExamSubmitResponse } from "@/types/cpa-exam";

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
  const { attemptId, totalTimeSeconds } = body as {
    attemptId: string;
    totalTimeSeconds: number;
  };

  if (!attemptId) {
    return NextResponse.json({ error: "attemptId is required" }, { status: 400 });
  }

  const attempt = await getAttemptById(attemptId);
  if (!attempt || attempt.userId !== user.id) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  const answers = await getAttemptAnswers(attemptId);

  let rawCorrect = 0;
  let totalQuestions = 0;
  for (const a of answers) {
    totalQuestions++;
    if (a.isCorrect) rawCorrect++;
  }

  const { scaledScore, passed } = computeSectionExamScore(rawCorrect, totalQuestions);

  await completeAttempt(attemptId, {
    rawScore: rawCorrect,
    scaledScore,
    totalTimeSeconds: totalTimeSeconds ?? 0,
  });

  await upsertSectionProgressAfterAttempt(user.id, attempt.section, scaledScore, passed);

  // Update subsection skills
  try {
    const problems = await getTestProblems(attempt.testId);
    const problemMap = new Map(problems.map((p) => [p.problemId, p]));

    const bySubtopic = new Map<
      string,
      { isCorrect: boolean; difficultyLevel: number }[]
    >();

    for (const a of answers) {
      if (a.selectedOption == null) continue;
      const problem = problemMap.get(a.problemId);
      if (!problem?.subtopicId) continue;

      const arr = bySubtopic.get(problem.subtopicId) ?? [];
      arr.push({
        isCorrect: a.isCorrect ?? false,
        difficultyLevel: problem.difficultyLevel ?? 5,
      });
      bySubtopic.set(problem.subtopicId, arr);
    }

    // Every problem in this exam belongs to the attempt's own CPA section.
    const sectionCategory: SectionCategory = attempt.section;

    let totalXpEarned = 0;

    for (const [subtopicId, subtopicAnswers] of bySubtopic) {
      let skill = await getSubsectionSkill(user.id, subtopicId);
      if (!skill) {
        await initializeAllSkills(user.id);
        skill = await getSubsectionSkill(user.id, subtopicId);
      }

      if (skill) {
        let currentSkill = skill;
        for (const answer of subtopicAnswers) {
          const mutations = updateSkillAfterAnswer(
            currentSkill,
            answer.isCorrect,
            answer.difficultyLevel
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
      }
    }

    if (totalXpEarned > 0) {
      await updateUser(clerkId, {
        totalXp: (user.totalXp ?? 0) + totalXpEarned,
      });
    }
  } catch (e) {
    console.error("Failed to update subsection skills:", e);
  }

  const response: CpaExamSubmitResponse = {
    section: attempt.section,
    rawScore: rawCorrect,
    scaledScore,
    passed,
  };

  return NextResponse.json(response);
}
