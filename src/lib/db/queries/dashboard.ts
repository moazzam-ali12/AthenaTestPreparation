import { supabase } from "@/lib/supabase/client";
import { getCurrentQuestStreak, getLocalDateString } from "@/lib/db/queries/daily-quest";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBREVS = ["S", "M", "T", "W", "T", "F", "S"];

export async function getDashboardData(userId: string) {
  const today = getLocalDateString();
  const todayDayOfWeek = DAY_NAMES[new Date().getDay()].toLowerCase();

  // Fetch sessions with schedule info (join via schedules)
  const [upcomingSessionsRes, allSessionsRes, queueRes] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, scheduled_date, status, schedules!schedule_id(day_of_week, start_time, end_time)")
      .eq("user_id", userId)
      .gte("scheduled_date", today)
      .order("scheduled_date", { ascending: true })
      .limit(5),
    supabase
      .from("sessions")
      .select("id, scheduled_date, status, schedules!schedule_id(day_of_week, start_time)")
      .eq("user_id", userId)
      .order("scheduled_date", { ascending: false })
      .limit(10),
    supabase
      .from("learning_queue")
      .select("id, lesson_id, status, progress_pct, lessons!lesson_id(title, estimated_duration_minutes)")
      .eq("user_id", userId),
  ]);

  type ScheduleInfo = { day_of_week: string; start_time: string; end_time?: string };

  const upcomingSessions = (upcomingSessionsRes.data ?? []).map((s) => {
    const sched = s.schedules as ScheduleInfo | null;
    return {
      id: s.id,
      scheduledDate: s.scheduled_date,
      status: s.status,
      dayOfWeek: sched?.day_of_week ?? null,
      startTime: sched?.start_time ?? null,
      endTime: sched?.end_time ?? null,
    };
  });

  const sessionHistory = (allSessionsRes.data ?? []).map((s) => {
    const sched = s.schedules as Pick<ScheduleInfo, "day_of_week" | "start_time"> | null;
    return {
      id: s.id,
      scheduledDate: s.scheduled_date,
      status: s.status,
      dayOfWeek: sched?.day_of_week ?? null,
      startTime: sched?.start_time ?? null,
    };
  });

  type LessonInfo = { title: string; estimated_duration_minutes: number };
  const queueItems = (queueRes.data ?? []).map((q) => {
    const lesson = q.lessons as LessonInfo | null;
    return {
      id: q.id,
      lessonId: q.lesson_id,
      status: q.status,
      progressPct: q.progress_pct,
      lessonTitle: lesson?.title ?? null,
      estimatedDuration: lesson?.estimated_duration_minutes ?? null,
    };
  });

  // Completion stats — fetch all sessions for user
  const { data: allStatusSessions } = await supabase
    .from("sessions")
    .select("status")
    .eq("user_id", userId);

  const completedSessions = (allStatusSessions ?? []).filter((s) => s.status === "completed").length;
  const totalSessions = (allStatusSessions ?? []).length;

  // Calculate streak from daily quest history (consecutive days)
  const streak = await getCurrentQuestStreak(userId);

  // Scores
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [allScoresRes, weeklyScoresRes] = await Promise.all([
    supabase
      .from("quiz_sessions")
      .select("score")
      .eq("user_id", userId)
      .eq("source", "cpa"),
    supabase
      .from("quiz_sessions")
      .select("score")
      .eq("user_id", userId)
      .eq("source", "cpa")
      .gte("created_at", sevenDaysAgo.toISOString()),
  ]);

  const totalScore = (allScoresRes.data ?? []).reduce((sum, s) => sum + s.score, 0);
  const weeklyDelta = (weeklyScoresRes.data ?? []).reduce((sum, s) => sum + s.score, 0);

  const pendingLessons = queueItems.filter((q) => q.status !== "completed");
  const completedLessons = queueItems.filter((q) => q.status === "completed");

  // Topics with subtopic counts
  const [topicsRes, subtopicsCountRes] = await Promise.all([
    supabase
      .from("topics")
      .select("id, slug, name, order_index")
      .order("order_index", { ascending: true }),
    supabase
      .from("subtopics")
      .select("id, topic_id"),
  ]);

  const subtopicsByTopic: Record<string, number> = {};
  for (const st of subtopicsCountRes.data ?? []) {
    subtopicsByTopic[st.topic_id] = (subtopicsByTopic[st.topic_id] ?? 0) + 1;
  }

  const topicRows = (topicsRes.data ?? []).map((t) => ({
    slug: t.slug,
    name: t.name,
    subtopicCount: subtopicsByTopic[t.id] ?? 0,
  }));

  // Weekly streak days — based on daily quests, not sessions
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfWeekStr = getLocalDateString(startOfWeek);

  const { data: weekQuestsData } = await supabase
    .from("daily_quests")
    .select("quest_date")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("quest_date", startOfWeekStr)
    .lte("quest_date", today);

  const completedDates = new Set((weekQuestsData ?? []).map((q) => q.quest_date));

  const weeklyStreakDays = DAY_ABBREVS.map((abbrev, idx) => {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + idx);
    const dateStr = getLocalDateString(dayDate);
    const completed = completedDates.has(dateStr);
    const isPast = dateStr < today && !completed;
    return { day: abbrev, completed, isPast };
  });

  // Battle zones: correct answers per topic
  // Approach: fetch user's quiz sessions → answers → subtopics → topics, aggregate in JS
  const { data: userSessions } = await supabase
    .from("quiz_sessions")
    .select("id, subtopic_id")
    .eq("user_id", userId)
    .eq("source", "cpa");

  let battleZones: { name: string; slug: string; done: number }[] = [];

  if ((userSessions ?? []).length > 0) {
    const sessionIds = (userSessions ?? []).map((s) => s.id);
    const subtopicIdsBySession: Record<string, string> = {};
    for (const s of userSessions ?? []) {
      if (s.subtopic_id) subtopicIdsBySession[s.id] = s.subtopic_id;
    }

    const [answersRes, subtopicsRes] = await Promise.all([
      supabase
        .from("quiz_answers")
        .select("session_id")
        .in("session_id", sessionIds)
        .eq("is_correct", true),
      supabase
        .from("subtopics")
        .select("id, topic_id"),
    ]);

    const subtopicToTopicId: Record<string, string> = {};
    for (const st of subtopicsRes.data ?? []) {
      subtopicToTopicId[st.id] = st.topic_id;
    }

    const topicIdsInUse = new Set(
      (userSessions ?? []).filter((s) => s.subtopic_id).map((s) => subtopicToTopicId[s.subtopic_id!]).filter(Boolean)
    );

    const { data: topicsData } = await supabase
      .from("topics")
      .select("id, name, slug, order_index")
      .in("id", Array.from(topicIdsInUse))
      .order("order_index", { ascending: true });

    const topicById: Record<string, { name: string; slug: string }> = {};
    for (const t of topicsData ?? []) {
      topicById[t.id] = { name: t.name, slug: t.slug };
    }

    // Count correct answers per topic
    const correctByTopic: Record<string, number> = {};
    for (const ans of answersRes.data ?? []) {
      const subtopicId = subtopicIdsBySession[ans.session_id];
      if (!subtopicId) continue;
      const topicId = subtopicToTopicId[subtopicId];
      if (!topicId) continue;
      correctByTopic[topicId] = (correctByTopic[topicId] ?? 0) + 1;
    }

    battleZones = (topicsData ?? []).map((t) => ({
      name: t.name,
      slug: t.slug,
      done: correctByTopic[t.id] ?? 0,
    }));
  }

  // Today's study time
  const { data: todayScheduleData } = await supabase
    .from("schedules")
    .select("start_time")
    .eq("user_id", userId)
    .eq("day_of_week", todayDayOfWeek)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const todayStudyTime = todayScheduleData?.start_time ?? null;

  // User's target CPA discipline section (replaces the old ACT target composite score)
  const { data: userRecord } = await supabase
    .from("users")
    .select("target_discipline_section")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();

  const targetDisciplineSection = userRecord?.target_discipline_section ?? null;

  // Friends scores
  const { data: friendRows } = await supabase
    .from("friendships")
    .select("friend_user_id, users!friend_user_id(display_name, avatar_url)")
    .eq("user_id", userId)
    .eq("status", "accepted");

  type FriendUserInfo = { display_name: string | null; avatar_url: string | null };
  const friendIds = (friendRows ?? []).map((f) => f.friend_user_id);
  let friendsScores: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
    totalScore: number;
    weeklyDelta: number;
  }[] = [];

  if (friendIds.length > 0) {
    const [allFriendScoresRes, weeklyFriendScoresRes] = await Promise.all([
      supabase
        .from("quiz_sessions")
        .select("user_id, score")
        .in("user_id", friendIds)
        .eq("source", "cpa"),
      supabase
        .from("quiz_sessions")
        .select("user_id, score")
        .in("user_id", friendIds)
        .eq("source", "cpa")
        .gte("created_at", sevenDaysAgo.toISOString()),
    ]);

    const totalScoreMap: Record<string, number> = {};
    for (const r of allFriendScoresRes.data ?? []) {
      totalScoreMap[r.user_id] = (totalScoreMap[r.user_id] ?? 0) + r.score;
    }

    const weeklyScoreMap: Record<string, number> = {};
    for (const r of weeklyFriendScoresRes.data ?? []) {
      weeklyScoreMap[r.user_id] = (weeklyScoreMap[r.user_id] ?? 0) + r.score;
    }

    friendsScores = (friendRows ?? []).map((f) => {
      const userInfo = f.users as FriendUserInfo | null;
      return {
        id: f.friend_user_id,
        displayName: userInfo?.display_name ?? null,
        avatarUrl: userInfo?.avatar_url ?? null,
        totalScore: totalScoreMap[f.friend_user_id] ?? 0,
        weeklyDelta: weeklyScoreMap[f.friend_user_id] ?? 0,
      };
    });
  }

  return {
    upcomingSessions,
    queueItems: pendingLessons.slice(0, 3),
    totalQueueCount: pendingLessons.length,
    completedLessonCount: completedLessons.length,
    completedSessions,
    totalSessions,
    streak,
    totalScore,
    weeklyDelta,
    topics: topicRows,
    weeklyStreakDays,
    battleZones,
    todayStudyTime,
    targetDisciplineSection,
    friendsScores,
  };
}
