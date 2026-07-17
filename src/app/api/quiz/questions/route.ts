import { auth } from "@clerk/nextjs/server";
import { getQuizQuestions } from "@/lib/db/queries/quiz";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getUserQuizAttempts } from "@/lib/db/queries/quiz";
import { getOnboardingProgress } from "@/lib/db/queries/onboarding";
import { getUserPreferences } from "@/lib/db/queries/preferences";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [questions, attempts, onboarding, preferences] = await Promise.all([
    getQuizQuestions(),
    getUserQuizAttempts(user.id),
    getOnboardingProgress(user.id),
    getUserPreferences(user.id),
  ]);

  // Build a set of already-answered question IDs
  const answeredIds = new Set(attempts.map((a) => a.questionId));

  return NextResponse.json({
    questions: questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      difficulty: q.difficulty,
      category: q.category,
      questionText: q.questionText,
      options: q.options,
      // Don't send correctOption to client
    })),
    answeredIds: Array.from(answeredIds),
    currentIndex: onboarding?.quizQuestionIndex ?? 0,
    lessonPreference: preferences?.lessonDelivery ?? null,
  });
}
