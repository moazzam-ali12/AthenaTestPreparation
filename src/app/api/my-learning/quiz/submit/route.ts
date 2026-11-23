import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { customQuestionReveal, getCustomTopicWithQuestions, saveCustomQuizSession } from "@/lib/db/queries/custom-learning";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    topicId?: string;
    timeElapsedSeconds?: number;
    answers?: { questionId: string; selectedOption: number; wrongCount?: number }[];
    // `score`, `totalQuestions` and each answer's `isCorrect` are ignored: computed below.
  } | null;

  const { topicId, timeElapsedSeconds, answers: clientAnswers } = body ?? {};
  if (!topicId || timeElapsedSeconds == null || !Array.isArray(clientAnswers)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Owner check + answer keys in one read.
  const topicData = await getCustomTopicWithQuestions(topicId, user.id);
  if (!topicData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const keys = new Map(topicData.questions.map((q) => [q.id, q.correctOption as number]));

  // Re-grade on the server; same rule as the quiz UI and act-quiz/submit:
  // a question counts only on a clean first try.
  const answers = clientAnswers
    .filter((a) => keys.has(a.questionId))
    .map((a) => ({
      ...a,
      isCorrect: a.selectedOption === keys.get(a.questionId) && (a.wrongCount ?? 0) === 0,
    }));
  const score = answers.filter((a) => a.isCorrect).length;
  const totalQuestions = topicData.questions.length;
  if (totalQuestions === 0) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const session = await saveCustomQuizSession({
    userId: user.id,
    topicId,
    score,
    totalQuestions,
    timeElapsedSeconds,
    answers,
  });

  // Quiz over: reveal every question of the topic for the review screen.
  const reveals = Object.fromEntries(
    topicData.questions.map((q) => [q.id, { ...customQuestionReveal(q), optionHints: [] }])
  );

  return NextResponse.json({ sessionId: session.id, score, totalQuestions, reveals });
}
