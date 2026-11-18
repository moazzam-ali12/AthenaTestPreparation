import { supabase } from "@/lib/supabase/client";
import { scaleScore, CPA_SECTIONS, SUBTOPIC_PASS_THRESHOLD } from "@/lib/cpa-scoring";

export async function getProgressData(userId: string) {
  // Fetch all quiz sessions for this user
  const { data: userSessions } = await supabase
    .from("quiz_sessions")
    .select("id, subtopic_id, score, total_questions, time_elapsed_seconds, created_at")
    .eq("user_id", userId)
    .eq("source", "cpa")
    .order("created_at", { ascending: true });

  const sessions = userSessions ?? [];
  const sessionIds = sessions.map((s) => s.id);

  // Fetch answers, subtopics, topics, and problems in parallel
  const [answersRes, subtopicsRes, topicsRes] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from("quiz_answers")
          .select("id, session_id, problem_id, is_correct")
          .in("session_id", sessionIds)
      : Promise.resolve({ data: [] }),
    supabase.from("subtopics").select("id, topic_id, name"),
    supabase
      .from("topics")
      .select("id, name, slug, subject, order_index")
      .order("order_index", { ascending: true }),
  ]);

  const answers = answersRes.data ?? [];
  const subtopics = subtopicsRes.data ?? [];
  const topics = topicsRes.data ?? [];

  // Fetch problem difficulties for answers
  const problemIds = [...new Set(answers.map((a) => a.problem_id))];
  const problemDifficultyMap: Record<string, string> = {};
  if (problemIds.length > 0) {
    const { data: problems } = await supabase
      .from("problems")
      .select("id, difficulty")
      .in("id", problemIds);
    for (const p of problems ?? []) {
      problemDifficultyMap[p.id] = p.difficulty;
    }
  }

  // Build lookup maps
  const subtopicMap: Record<string, { topic_id: string; name: string }> = {};
  for (const st of subtopics) {
    subtopicMap[st.id] = { topic_id: st.topic_id, name: st.name };
  }

  const topicMap: Record<string, { name: string; slug: string; subject: string; order_index: number }> = {};
  for (const t of topics) {
    topicMap[t.id] = { name: t.name, slug: t.slug, subject: t.subject, order_index: t.order_index };
  }

  const sessionMap: Record<string, { subtopic_id: string | null; score: number; total_questions: number; time_elapsed_seconds: number; created_at: string }> = {};
  for (const s of sessions) {
    sessionMap[s.id] = s;
  }

  // 1. Score history: cumulative score by date
  const dailyScores: Record<string, number> = {};
  for (const s of sessions) {
    const date = s.created_at.split("T")[0];
    dailyScores[date] = (dailyScores[date] ?? 0) + s.score;
  }
  let cumulative = 0;
  const cumulativeScoreHistory = Object.entries(dailyScores)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dailyScore]) => {
      cumulative += dailyScore;
      return { date, score: cumulative };
    });

  // 1b. Accuracy over time: per-session accuracy (%) by date, chronological.
  // Complements the categorical accuracyByDifficulty snapshot with a trend line.
  const accuracyOverTime = sessions
    .filter((s) => s.total_questions > 0)
    .map((s) => ({
      date: s.created_at.split("T")[0],
      accuracy: Math.round((s.score / s.total_questions) * 100),
    }));

  // 2. Accuracy by difficulty
  const difficultyStats: Record<string, { total: number; correct: number }> = {};
  for (const ans of answers) {
    const difficulty = problemDifficultyMap[ans.problem_id];
    if (!difficulty) continue;
    if (!difficultyStats[difficulty]) difficultyStats[difficulty] = { total: 0, correct: 0 };
    difficultyStats[difficulty].total++;
    if (ans.is_correct) difficultyStats[difficulty].correct++;
  }
  const accuracyByDifficulty = Object.entries(difficultyStats).map(([difficulty, stats]) => ({
    difficulty,
    total: stats.total,
    correct: stats.correct,
    accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
  }));

  // 3. Topic performance
  const topicPerfStats: Record<string, { total: number; correct: number }> = {};
  for (const ans of answers) {
    const session = sessionMap[ans.session_id];
    if (!session || !session.subtopic_id) continue;
    const subtopic = subtopicMap[session.subtopic_id];
    if (!subtopic) continue;
    const topicId = subtopic.topic_id;
    if (!topicPerfStats[topicId]) topicPerfStats[topicId] = { total: 0, correct: 0 };
    topicPerfStats[topicId].total++;
    if (ans.is_correct) topicPerfStats[topicId].correct++;
  }

  const topicPerfMap: Record<string, { total: number; correct: number }> = {};
  for (const [topicId, stats] of Object.entries(topicPerfStats)) {
    const topic = topicMap[topicId];
    if (topic) topicPerfMap[topic.slug] = stats;
  }

  const allTopicPerformance = topics.map((t) => {
    const perf = topicPerfMap[t.slug];
    return {
      name: t.name,
      slug: t.slug,
      subject: t.subject,
      total: perf?.total ?? 0,
      correct: perf?.correct ?? 0,
      accuracy:
        perf && perf.total > 0
          ? Math.round((perf.correct / perf.total) * 100)
          : 0,
    };
  });

  // 4. Recent sessions with subtopic name
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      subtopicName: (s.subtopic_id ? subtopicMap[s.subtopic_id]?.name : "") ?? "",
      score: s.score,
      totalQuestions: s.total_questions,
      timeElapsedSeconds: s.time_elapsed_seconds,
      date: s.created_at,
    }));

  // 5. Overall stats
  const totalQ = answers.length;
  const totalCorrect = answers.filter((a) => a.is_correct).length;
  const totalTime = sessions.reduce((sum, s) => sum + s.time_elapsed_seconds, 0);
  const totalScore = sessions.reduce((sum, s) => sum + s.score, 0);
  const sessionCount = sessions.length;

  // 6. Section scores
  const sectionStats: Record<string, { total: number; correct: number }> = {};
  for (const ans of answers) {
    const session = sessionMap[ans.session_id];
    if (!session || !session.subtopic_id) continue;
    const subtopic = subtopicMap[session.subtopic_id];
    if (!subtopic) continue;
    const topic = topicMap[subtopic.topic_id];
    if (!topic) continue;
    const subject = topic.subject;
    if (!sectionStats[subject]) sectionStats[subject] = { total: 0, correct: 0 };
    sectionStats[subject].total++;
    if (ans.is_correct) sectionStats[subject].correct++;
  }

  const sections = Object.entries(sectionStats).map(([subject, stats]) => ({
    subject,
    total: stats.total,
    correct: stats.correct,
    accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
    scaledScore: scaleScore(stats.correct, stats.total),
  }));

  const defaultSection = (subject: string) => ({ subject, total: 0, correct: 0, accuracy: 0, scaledScore: 0 });
  const sectionScoresBySection = Object.fromEntries(
    CPA_SECTIONS.map((section) => {
      const key = section.toLowerCase();
      return [key, sections.find((s) => s.subject === key) ?? defaultSection(key)];
    })
  ) as Record<Lowercase<(typeof CPA_SECTIONS)[number]>, ReturnType<typeof defaultSection>>;

  // Topic mastery
  // Best score per subtopic (mirrors next-lesson.ts's pass/fail logic, so
  // Topic Mastery stays consistent with what /queue considers "passed").
  const subtopicBestScore: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.subtopic_id || !s.total_questions) continue;
    const pct = s.score / s.total_questions;
    if ((subtopicBestScore[s.subtopic_id] ?? 0) < pct) {
      subtopicBestScore[s.subtopic_id] = pct;
    }
  }

  const subtopicsByTopic: Record<string, typeof subtopics> = {};
  for (const st of subtopics) {
    if (!subtopicsByTopic[st.topic_id]) subtopicsByTopic[st.topic_id] = [];
    subtopicsByTopic[st.topic_id].push(st);
  }

  // A topic is "mastered" once every one of its subtopics is individually
  // passed — a failed subtopic no longer erases credit for a passed one.
  const topicMasteryList = topics.map((t) => {
    const topicSubtopics = subtopicsByTopic[t.id] ?? [];
    const attempted = topicSubtopics.some((st) => subtopicBestScore[st.id] !== undefined);
    const mastered =
      topicSubtopics.length > 0 &&
      topicSubtopics.every((st) => (subtopicBestScore[st.id] ?? 0) >= SUBTOPIC_PASS_THRESHOLD);
    return {
      name: t.name,
      mastered,
      attempted,
    };
  });

  const masteredCount = topicMasteryList.filter((s) => s.mastered).length;

  // Per-topic accuracy trend over time.
  // The overall improvementTrend (in analytics.ts) is a single global signal;
  // this breaks it down per topic so a learner can see which areas are moving
  // up vs. sliding. Each topic's sessions (already chronological) are split into
  // an earlier and later half; the delta in mean per-session accuracy drives the
  // direction, using the same ±5% band as the global trend for consistency.
  const TREND_BAND = 5; // percentage points
  const MIN_TREND_SESSIONS = 4; // need enough sessions for two meaningful halves

  const sessionsByTopic: Record<string, { accuracy: number }[]> = {};
  for (const s of sessions) {
    if (!s.subtopic_id || !s.total_questions) continue;
    const subtopic = subtopicMap[s.subtopic_id];
    if (!subtopic) continue;
    const topic = topicMap[subtopic.topic_id];
    if (!topic) continue;
    (sessionsByTopic[topic.slug] ??= []).push({
      accuracy: Math.round((s.score / s.total_questions) * 100),
    });
  }

  const mean = (nums: number[]) =>
    nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

  const topicTrends = topics
    .map((t) => {
      const topicSessions = sessionsByTopic[t.slug] ?? [];
      if (topicSessions.length < MIN_TREND_SESSIONS) return null;

      const mid = Math.floor(topicSessions.length / 2);
      const earlier = mean(topicSessions.slice(0, mid).map((s) => s.accuracy));
      const later = mean(topicSessions.slice(mid).map((s) => s.accuracy));
      const delta = Math.round(later - earlier);
      const direction: "improving" | "declining" | "stable" =
        delta > TREND_BAND ? "improving" : delta < -TREND_BAND ? "declining" : "stable";

      return {
        name: t.name,
        slug: t.slug,
        subject: t.subject,
        sessionCount: topicSessions.length,
        earlierAccuracy: Math.round(earlier),
        latestAccuracy: topicSessions[topicSessions.length - 1].accuracy,
        delta,
        direction,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    // Biggest movers first (largest absolute change), so the most actionable
    // trends surface at the top.
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    scoreHistory: cumulativeScoreHistory,
    accuracyOverTime,
    accuracyByDifficulty,
    topicPerformance: allTopicPerformance,
    topicTrends,
    recentSessions,
    overallStats: {
      totalQuestions: totalQ,
      accuracy: totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0,
      totalTimeSeconds: totalTime,
      sessionCount,
      avgScore: sessionCount > 0 ? Math.round(totalScore / sessionCount) : 0,
    },
    sectionScores: sectionScoresBySection,
    topicMastery: {
      items: topicMasteryList,
      masteredCount,
      totalCount: topicMasteryList.length,
    },
  };
}
