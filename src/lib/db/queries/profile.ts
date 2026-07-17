import { supabase } from "@/lib/supabase/client";
import { getCurrentQuestStreak } from "@/lib/db/queries/daily-quest";

export async function getProfileData(userId: string) {
  const [
    userRes,
    quizSessionsRes,
    streak,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("display_name, avatar_url, created_at, target_discipline_section, best_streak")
      .eq("id", userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("quiz_sessions")
      .select("id, score, total_questions, time_elapsed_seconds")
      .eq("user_id", userId)
      .eq("source", "cpa"),
    getCurrentQuestStreak(userId),
  ]);

  const userRecord = userRes.data;
  const quizSessions = quizSessionsRes.data ?? [];

  // Fetch answers for all quiz sessions
  const sessionIds = quizSessions.map((s) => s.id);
  let totalAnswers = 0;
  let correctAnswers = 0;

  if (sessionIds.length > 0) {
    const { data: answers } = await supabase
      .from("quiz_answers")
      .select("is_correct")
      .in("session_id", sessionIds);

    totalAnswers = answers?.length ?? 0;
    correctAnswers = answers?.filter((a) => a.is_correct).length ?? 0;
  }

  const totalScore = quizSessions.reduce((sum, s) => sum + s.score, 0);
  const totalTimeSeconds = quizSessions.reduce(
    (sum, s) => sum + s.time_elapsed_seconds,
    0
  );
  const accuracy =
    totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

  return {
    user: userRecord
      ? {
          displayName: userRecord.display_name,
          avatarUrl: userRecord.avatar_url,
          createdAt: userRecord.created_at as string,
          targetDisciplineSection: userRecord.target_discipline_section,
          bestStreak: userRecord.best_streak,
        }
      : null,
    totalScore,
    questsDone: quizSessions.length,
    totalTimeSeconds,
    accuracy,
    streak,
    bestStreak: userRecord?.best_streak ?? 0,
  };
}
