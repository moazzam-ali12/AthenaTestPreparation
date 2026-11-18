import { supabase } from "@/lib/supabase/client";

export type StuckPoint = {
  subtopicId: string;
  subtopicName: string;
  subtopicSlug: string;
  topicName: string;
  topicSlug: string;
  stuckScore: number;
  metrics: {
    accuracy: number;
    wrongRate: number;
    hintRate: number;
    tutorRate: number;
    avgResponseTimeMs: number;
    totalAttempts: number;
    recentTrend: number;
    microLessonCompleted: boolean;
  };
  recommendation: "micro-lesson" | "practice" | "review-quiz";
};

export type EngagementSummary = {
  totalQuizTimeSeconds: number;
  totalLessonTimeSeconds: number;
  microLessonCompletionRate: number;
  avgHintsPerQuestion: number;
  avgTutorEntriesPerSession: number;
  fullScaffoldingCount: number;
  improvementTrend: "improving" | "stable" | "declining";
};

export type WeakConcept = {
  tag: string;
  /** Missed: is_correct = false — wrong or skipped (stored as selected_option = -1). */
  missCount: number;
  /** Struggled: answered correctly but only after ≥1 wrong attempt (wrong_count > 0). */
  struggled: number;
};
export type WeakConceptSummary = {
  concepts: WeakConcept[];
  /** Total questions the user did not get right (wrong or skipped). */
  totalMissed: number;
};

/**
 * Concept-level weakness summary across the user's answers, split into two
 * buckets by `concept_tags` (falling back to difficulty when a problem has no
 * tags):
 *   - missed:    is_correct = false. The quiz stores every incorrect answer
 *                with selected_option = -1, so wrong vs. skipped can't be
 *                distinguished — both count as "missed".
 *   - struggled: is_correct = true but wrong_count > 0 (solved eventually,
 *                after ≥1 wrong attempt).
 * Ranked by total weak count (missed + struggled) desc.
 */
export async function getWeakConcepts(userId: string, limit = 8): Promise<WeakConceptSummary> {
  const empty: WeakConceptSummary = { concepts: [], totalMissed: 0 };

  const { data: sessions } = await supabase
    .from("quiz_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "cpa");
  if (!sessions || sessions.length === 0) return empty;

  const sessionIds = sessions.map((s) => s.id);

  const { data: answers } = await (supabase as any)
    .from("quiz_answers")
    .select("problem_id, is_correct, wrong_count")
    .in("session_id", sessionIds) as { data: {
      problem_id: string;
      is_correct: boolean;
      wrong_count: number | null;
    }[] | null };
  if (!answers || answers.length === 0) return empty;

  const problemIds = [...new Set(answers.map((a) => a.problem_id))];
  const { data: problems } = await supabase
    .from("problems")
    .select("id, concept_tags, difficulty")
    .in("id", problemIds);

  const infoByProblem = new Map(
    (problems ?? []).map((p: any) => [
      p.id,
      { tags: (p.concept_tags as string[]) ?? [], difficulty: p.difficulty as string | null },
    ])
  );

  const counts = new Map<string, { missCount: number; struggled: number }>();
  let totalMissed = 0;
  for (const a of answers) {
    const missed = !a.is_correct;
    const struggled = a.is_correct && (a.wrong_count ?? 0) > 0;
    if (!missed && !struggled) continue;
    if (missed) totalMissed++;

    const info = infoByProblem.get(a.problem_id);
    const labels =
      info && info.tags.length > 0 ? info.tags : [`${info?.difficulty ?? "unknown"} problems`];
    for (const t of labels) {
      const c = counts.get(t) ?? { missCount: 0, struggled: 0 };
      if (missed) c.missCount += 1;
      else c.struggled += 1;
      counts.set(t, c);
    }
  }

  const concepts = [...counts.entries()]
    .map(([tag, c]) => ({ tag, ...c }))
    .sort((a, b) => b.missCount + b.struggled - (a.missCount + a.struggled))
    .slice(0, limit);

  return { concepts, totalMissed };
}

export async function getStuckPoints(userId: string): Promise<StuckPoint[]> {
  // 1. Get subsection skills
  const { data: skills } = await supabase
    .from("subsection_skills")
    .select("subtopic_id, level, total_attempts, correct_attempts, last_10")
    .eq("user_id", userId);

  if (!skills || skills.length === 0) return [];

  const skillMap = new Map(
    skills.map((s) => [s.subtopic_id, s])
  );

  // 2. Get recent quiz answers with tracking columns (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sessions } = await supabase
    .from("quiz_sessions")
    .select("id, subtopic_id")
    .eq("user_id", userId)
    .eq("source", "cpa")
    .gte("created_at", thirtyDaysAgo);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const sessionSubtopicMap = new Map(sessions.map((s) => [s.id, s.subtopic_id]));

  const { data: answers } = await (supabase as any)
    .from("quiz_answers")
    .select("session_id, is_correct, wrong_count, hint_used, tutor_used, practice_completed, response_time_ms")
    .in("session_id", sessionIds) as { data: {
      session_id: string;
      is_correct: boolean;
      wrong_count: number | null;
      hint_used: boolean | null;
      tutor_used: boolean | null;
      practice_completed: boolean | null;
      response_time_ms: number | null;
    }[] | null };

  if (!answers || answers.length === 0) return [];

  // 3. Group answers by subtopic
  type SubtopicStats = {
    total: number;
    correct: number;
    withWrong: number;
    withHint: number;
    withTutor: number;
    responseTimes: number[];
  };

  const statsMap = new Map<string, SubtopicStats>();

  for (const a of answers) {
    const subtopicId = sessionSubtopicMap.get(a.session_id);
    if (!subtopicId) continue;

    if (!statsMap.has(subtopicId)) {
      statsMap.set(subtopicId, { total: 0, correct: 0, withWrong: 0, withHint: 0, withTutor: 0, responseTimes: [] });
    }
    const s = statsMap.get(subtopicId)!;
    s.total++;
    if (a.is_correct) s.correct++;
    if (a.wrong_count && a.wrong_count > 0) s.withWrong++;
    if (a.hint_used) s.withHint++;
    if (a.tutor_used) s.withTutor++;
    if (a.response_time_ms) s.responseTimes.push(a.response_time_ms);
  }

  // 4. Get micro-lesson completion status
  const subtopicIds = [...statsMap.keys()];
  const { data: lessonSessions } = await (supabase as any)
    .from("micro_lesson_sessions")
    .select("subtopic_id, completed")
    .eq("user_id", userId)
    .in("subtopic_id", subtopicIds) as { data: { subtopic_id: string; completed: boolean }[] | null };

  const completedLessons = new Set(
    (lessonSessions ?? []).filter((s) => s.completed).map((s) => s.subtopic_id)
  );

  // 5. Get subtopic/topic names
  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("id, name, slug, topics!inner(name, slug)")
    .in("id", subtopicIds);

  const subtopicInfo = new Map(
    (subtopics ?? []).map((st) => {
      const topic = st.topics as unknown as { name: string; slug: string };
      return [st.id, { name: st.name, slug: st.slug, topicName: topic.name, topicSlug: topic.slug }];
    })
  );

  // 6. Compute stuck scores
  const results: StuckPoint[] = [];

  for (const [subtopicId, stats] of statsMap) {
    const skill = skillMap.get(subtopicId);
    const info = subtopicInfo.get(subtopicId);
    if (!info) continue;

    const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;
    const wrongRate = stats.total > 0 ? (stats.withWrong / stats.total) * 100 : 0;
    const hintRate = stats.total > 0 ? (stats.withHint / stats.total) * 100 : 0;
    const tutorRate = stats.total > 0 ? (stats.withTutor / stats.total) * 100 : 0;
    const avgResponseTimeMs = stats.responseTimes.length > 0
      ? stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
      : 0;

    // Recent trend: count wrongs in last 10 attempts
    const last10 = skill?.last_10 as boolean[] | null;
    const recentTrend = last10 ? last10.filter((v) => !v).length : 0;

    const microLessonCompleted = completedLessons.has(subtopicId);

    // Stuck score: higher = more stuck
    const stuckScore =
      (wrongRate / 100) * 3 +
      (tutorRate / 100) * 4 +
      ((100 - accuracy) / 100) * 2 +
      (recentTrend / 10);

    let recommendation: StuckPoint["recommendation"] = "practice";
    if (!microLessonCompleted) recommendation = "micro-lesson";
    else if (accuracy < 50) recommendation = "review-quiz";

    results.push({
      subtopicId,
      subtopicName: info.name,
      subtopicSlug: info.slug,
      topicName: info.topicName,
      topicSlug: info.topicSlug,
      stuckScore,
      metrics: {
        accuracy: Math.round(accuracy),
        wrongRate: Math.round(wrongRate),
        hintRate: Math.round(hintRate),
        tutorRate: Math.round(tutorRate),
        avgResponseTimeMs: Math.round(avgResponseTimeMs),
        totalAttempts: stats.total,
        recentTrend,
        microLessonCompleted,
      },
      recommendation,
    });
  }

  // Sort by stuck score descending
  results.sort((a, b) => b.stuckScore - a.stuckScore);
  return results;
}

// ── Personalized learning summary ──
// Deterministic narrative synthesized from stuck-points + engagement trend, so
// the progress page can show a per-user "here's where you stand" card without
// an extra LLM call.

export type LearningSummary = {
  headline: string;
  /** 1-3 personalized sentences, rendered as separate lines. */
  narrative: string[];
  focusArea: {
    subtopicName: string;
    topicName: string;
    topicSlug: string;
    subtopicSlug: string;
    accuracy: number;
    recommendation: StuckPoint["recommendation"];
  } | null;
  strength: { subtopicName: string; accuracy: number } | null;
  trend: EngagementSummary["improvementTrend"];
  overallAccuracy: number;
  subtopicsAttempted: number;
};

const RECOMMENDATION_ACTION: Record<StuckPoint["recommendation"], string> = {
  "micro-lesson": "Start its micro-lesson to rebuild the foundation.",
  practice: "Run a few targeted practice problems to lock it in.",
  "review-quiz": "Retake its quiz to solidify what you know.",
};

export async function getLearningSummary(userId: string): Promise<LearningSummary> {
  const [stuckPoints, engagement] = await Promise.all([
    getStuckPoints(userId),
    getEngagementSummary(userId),
  ]);

  const trend = engagement.improvementTrend;

  if (stuckPoints.length === 0) {
    return {
      headline: "Let's get your baseline",
      narrative: [
        "You haven't logged enough practice yet for a personalized read.",
        "Complete a quiz or two and your strengths and focus areas will show up here.",
      ],
      focusArea: null,
      strength: null,
      trend,
      overallAccuracy: 0,
      subtopicsAttempted: 0,
    };
  }

  const totalAttempts = stuckPoints.reduce((s, p) => s + p.metrics.totalAttempts, 0);
  const weightedCorrect = stuckPoints.reduce(
    (s, p) => s + (p.metrics.accuracy / 100) * p.metrics.totalAttempts,
    0
  );
  const overallAccuracy =
    totalAttempts > 0 ? Math.round((weightedCorrect / totalAttempts) * 100) : 0;

  // stuckPoints are sorted by stuckScore desc; the top one is the focus area.
  const top = stuckPoints[0];
  const focusArea =
    top.metrics.accuracy < 80
      ? {
          subtopicName: top.subtopicName,
          topicName: top.topicName,
          topicSlug: top.topicSlug,
          subtopicSlug: top.subtopicSlug,
          accuracy: top.metrics.accuracy,
          recommendation: top.recommendation,
        }
      : null;

  const strengthCandidate = [...stuckPoints]
    .filter((p) => p.metrics.totalAttempts >= 3 && p.metrics.accuracy >= 80)
    .sort((a, b) => b.metrics.accuracy - a.metrics.accuracy)[0];
  const strength = strengthCandidate
    ? { subtopicName: strengthCandidate.subtopicName, accuracy: strengthCandidate.metrics.accuracy }
    : null;

  const headline =
    trend === "improving"
      ? "You're trending upward"
      : trend === "declining"
        ? "Let's turn the trend around"
        : "Steady, keep it going";

  const narrative: string[] = [];
  narrative.push(
    `You're averaging ${overallAccuracy}% accuracy across ${stuckPoints.length} subsection${stuckPoints.length === 1 ? "" : "s"}, and your recent trend is ${trend}.`
  );
  if (strength) {
    narrative.push(
      `${strength.subtopicName} is a clear strength at ${strength.accuracy}% — nice work there.`
    );
  }
  if (focusArea) {
    narrative.push(
      `Your best next move is ${focusArea.subtopicName} (${focusArea.accuracy}%). ${RECOMMENDATION_ACTION[focusArea.recommendation]}`
    );
  } else {
    narrative.push("No weak spots stand out right now — push into harder material to keep growing.");
  }

  return {
    headline,
    narrative,
    focusArea,
    strength,
    trend,
    overallAccuracy,
    subtopicsAttempted: stuckPoints.length,
  };
}

/** Lightweight per-subtopic accuracy, scoped to one subtopic (last 30 days). */
export async function getSubtopicAccuracy(
  userId: string,
  subtopicId: string
): Promise<{ accuracy: number; totalAttempts: number }> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: sessions } = await supabase
    .from("quiz_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("subtopic_id", subtopicId)
    .eq("source", "cpa")
    .gte("created_at", thirtyDaysAgo);

  if (!sessions || sessions.length === 0) return { accuracy: 100, totalAttempts: 0 };

  const sessionIds = sessions.map((s) => s.id);
  const { data: answers } = await supabase
    .from("quiz_answers")
    .select("is_correct")
    .in("session_id", sessionIds);

  const totalAttempts = answers?.length ?? 0;
  if (totalAttempts === 0) return { accuracy: 100, totalAttempts: 0 };

  const correct = answers!.filter((a) => a.is_correct).length;
  return { accuracy: Math.round((correct / totalAttempts) * 100), totalAttempts };
}

// ── Mentor attempt context ──
// Recent wrong answers + per-subsection accuracy, so the mentor can reference
// specific missed concepts/questions rather than only scores.

export type MentorAttempt = {
  subsection: string;
  conceptTags: string[];
  chosenAnswer: string;
  correctAnswer: string;
  misconception: string | null;
  difficulty: string;
  responseTimeMs: number | null;
};

export type MentorAttemptContext = {
  recentWrongAttempts: MentorAttempt[];
  subsectionAccuracy: { subsection: string; accuracy: number; attempts: number }[];
};

// Keep injected option text short to hold token use down.
function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export async function getMentorAttemptContext(
  userId: string,
  maxWrong = 20
): Promise<MentorAttemptContext> {
  const { data: sessions } = await supabase
    .from("quiz_sessions")
    .select("id, subtopic_id")
    .eq("user_id", userId)
    .eq("source", "cpa");

  if (!sessions || sessions.length === 0) {
    return { recentWrongAttempts: [], subsectionAccuracy: [] };
  }

  const sessionSubtopic = new Map(sessions.map((s) => [s.id, s.subtopic_id]));
  const sessionIds = sessions.map((s) => s.id);

  const { data: answers } = await (supabase as any)
    .from("quiz_answers")
    .select("session_id, problem_id, selected_option, is_correct, response_time_ms, created_at")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false }) as { data: {
      session_id: string;
      problem_id: string;
      selected_option: number | null;
      is_correct: boolean;
      response_time_ms: number | null;
      created_at: string;
    }[] | null };

  if (!answers || answers.length === 0) {
    return { recentWrongAttempts: [], subsectionAccuracy: [] };
  }

  // Per-subtopic accuracy across all answers
  const accMap = new Map<string, { total: number; correct: number }>();
  for (const a of answers) {
    const st = sessionSubtopic.get(a.session_id);
    if (!st) continue;
    if (!accMap.has(st)) accMap.set(st, { total: 0, correct: 0 });
    const e = accMap.get(st)!;
    e.total++;
    if (a.is_correct) e.correct++;
  }

  // Actual wrong picks live in the event log, not quiz_answers: a committed
  // wrong answer is never a final state (it's resolved via hint/tutor or left
  // unanswered with selected_option = -1), so quiz_answers.is_correct = false
  // rows carry no chosen option. quiz_question_events "answer_wrong" rows do.
  const { data: wrongEvents } = await (supabase as any)
    .from("quiz_question_events")
    .select("session_id, problem_id, selected_option, response_time_ms")
    .in("session_id", sessionIds)
    .eq("event_type", "answer_wrong")
    .order("created_at", { ascending: false }) as { data: {
      session_id: string;
      problem_id: string;
      selected_option: number | null;
      response_time_ms: number | null;
    }[] | null };

  // Keep the most recent wrong pick per problem, up to maxWrong.
  const seenProblems = new Set<string>();
  const wrong: NonNullable<typeof wrongEvents> = [];
  for (const e of wrongEvents ?? []) {
    if (seenProblems.has(e.problem_id)) continue;
    seenProblems.add(e.problem_id);
    wrong.push(e);
    if (wrong.length >= maxWrong) break;
  }

  const problemIds = [...new Set(wrong.map((a) => a.problem_id))];
  const subtopicIds = [...accMap.keys()];

  const [problemsRes, subtopicsRes] = await Promise.all([
    problemIds.length > 0
      ? supabase
          .from("problems")
          .select("id, options, correct_option, concept_tags, option_hints, difficulty")
          .in("id", problemIds)
      : Promise.resolve({ data: [] }),
    supabase.from("subtopics").select("id, name").in("id", subtopicIds),
  ]);

  const problemMap = new Map(
    (problemsRes.data ?? []).map((p: any) => [p.id, p])
  );
  const subtopicName = new Map(
    (subtopicsRes.data ?? []).map((s: any) => [s.id, s.name])
  );

  const recentWrongAttempts: MentorAttempt[] = wrong.map((a) => {
    const p: any = problemMap.get(a.problem_id);
    const options: string[] = (p?.options as string[]) ?? [];
    const optionHints: { optionIndex: number; misconception: string; hint: string }[] =
      p?.option_hints ?? [];
    const hint =
      a.selected_option != null
        ? optionHints.find((h) => h.optionIndex === a.selected_option)
        : undefined;
    const st = sessionSubtopic.get(a.session_id);
    return {
      subsection: (st && subtopicName.get(st)) || "Unknown",
      conceptTags: (p?.concept_tags as string[]) ?? [],
      chosenAnswer:
        a.selected_option != null
          ? truncate(options[a.selected_option] ?? `Option ${a.selected_option}`)
          : "No answer",
      correctAnswer: p
        ? truncate(options[p.correct_option] ?? `Option ${p.correct_option}`)
        : "Unknown",
      misconception: hint?.misconception ?? null,
      difficulty: p?.difficulty ?? "unknown",
      responseTimeMs: a.response_time_ms,
    };
  });

  const subsectionAccuracy = [...accMap.entries()]
    .map(([st, e]) => ({
      subsection: subtopicName.get(st) ?? "Unknown",
      accuracy: e.total > 0 ? Math.round((e.correct / e.total) * 100) : 0,
      attempts: e.total,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  return { recentWrongAttempts, subsectionAccuracy };
}

export async function getEngagementSummary(userId: string): Promise<EngagementSummary> {
  // Quiz time
  const { data: quizSessions } = await supabase
    .from("quiz_sessions")
    .select("time_elapsed_seconds")
    .eq("user_id", userId);

  const totalQuizTimeSeconds = (quizSessions ?? []).reduce(
    (sum, s) => sum + (s.time_elapsed_seconds ?? 0),
    0
  );

  // Lesson time
  const { data: lessonSessions } = await (supabase as any)
    .from("micro_lesson_sessions")
    .select("duration_seconds, completed")
    .eq("user_id", userId) as { data: { duration_seconds: number; completed: boolean }[] | null };

  const totalLessonTimeSeconds = (lessonSessions ?? []).reduce(
    (sum, s) => sum + (s.duration_seconds ?? 0),
    0
  );

  const totalLessons = (lessonSessions ?? []).length;
  const completedLessons = (lessonSessions ?? []).filter((s) => s.completed).length;
  const microLessonCompletionRate = totalLessons > 0
    ? Math.round((completedLessons / totalLessons) * 100)
    : 0;

  // Hint and tutor usage from quiz_answers
  const { data: answers } = await (supabase as any)
    .from("quiz_answers")
    .select("hint_used, tutor_used, practice_completed, session_id")
    .eq("user_id", userId) as { data: { hint_used: boolean | null; tutor_used: boolean | null; practice_completed: boolean | null; session_id: string }[] | null };

  // quiz_answers doesn't have user_id directly, so we need to go through sessions
  const { data: userSessions } = await supabase
    .from("quiz_sessions")
    .select("id")
    .eq("user_id", userId);

  const userSessionIds = new Set((userSessions ?? []).map((s) => s.id));

  const { data: allAnswers } = await (supabase as any)
    .from("quiz_answers")
    .select("hint_used, tutor_used, practice_completed, session_id")
    .in("session_id", [...userSessionIds]) as { data: { hint_used: boolean | null; tutor_used: boolean | null; practice_completed: boolean | null; session_id: string }[] | null };

  const totalAnswers = (allAnswers ?? []).length;
  const hintsUsed = (allAnswers ?? []).filter((a) => a.hint_used).length;
  const tutorsUsed = (allAnswers ?? []).filter((a) => a.tutor_used).length;
  const fullScaffoldingCount = (allAnswers ?? []).filter(
    (a) => a.hint_used && a.tutor_used && a.practice_completed
  ).length;

  const avgHintsPerQuestion = totalAnswers > 0
    ? Math.round((hintsUsed / totalAnswers) * 100) / 100
    : 0;

  const totalUserSessions = (userSessions ?? []).length;
  const avgTutorEntriesPerSession = totalUserSessions > 0
    ? Math.round((tutorsUsed / totalUserSessions) * 100) / 100
    : 0;

  // Improvement trend: compare accuracy of first half vs second half of sessions
  const { data: recentSessions } = await supabase
    .from("quiz_sessions")
    .select("id, score, total_questions, created_at")
    .eq("user_id", userId)
    .eq("source", "cpa")
    .order("created_at", { ascending: true });

  let improvementTrend: EngagementSummary["improvementTrend"] = "stable";
  if (recentSessions && recentSessions.length >= 4) {
    const mid = Math.floor(recentSessions.length / 2);
    const firstHalf = recentSessions.slice(0, mid);
    const secondHalf = recentSessions.slice(mid);

    const avgFirst = firstHalf.reduce((s, r) => s + (r.total_questions > 0 ? r.score / r.total_questions : 0), 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, r) => s + (r.total_questions > 0 ? r.score / r.total_questions : 0), 0) / secondHalf.length;

    const delta = avgSecond - avgFirst;
    if (delta > 0.05) improvementTrend = "improving";
    else if (delta < -0.05) improvementTrend = "declining";
  }

  return {
    totalQuizTimeSeconds,
    totalLessonTimeSeconds,
    microLessonCompletionRate,
    avgHintsPerQuestion,
    avgTutorEntriesPerSession,
    fullScaffoldingCount,
    improvementTrend,
  };
}
