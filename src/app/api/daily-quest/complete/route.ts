import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import {
  completeDailyQuest,
  getCurrentQuestStreak,
  getLocalDateString,
  recordStreakDay,
} from "@/lib/db/queries/daily-quest";
import { generateQuestForDate } from "@/lib/adaptive/generate-quest";
import { checkNewUnlocks } from "@/lib/gamification/check-unlocks";
import { supabase } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import { NextResponse, after } from "next/server";
import { notifyQuestComplete } from "@/lib/notifications/events";
import { liveQuestCompleteDeps } from "@/lib/notifications/store";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: { questId?: string; timeElapsedSeconds?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { questId, timeElapsedSeconds } = body;

  if (!questId || timeElapsedSeconds == null) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Aggregate results from quest problems
  type QuestProblemRow = { is_correct: boolean; difficulty_level: number };
  const problemsRes = await supabase
    .from("daily_quest_problems")
    .select("is_correct, difficulty_level")
    .eq("quest_id", questId)
    .not("is_correct", "is", null);
  const problems = problemsRes.data as QuestProblemRow[] | null;

  const answered = problems ?? [];
  const correctCount = answered.filter((p) => p.is_correct).length;
  const score = correctCount;

  // Sum XP from answered problems (already applied per-answer, but record total)
  let xpTotal = 0;
  for (const p of answered) {
    if (p.is_correct) {
      const dl = p.difficulty_level;
      if (dl >= 9) xpTotal += 40;
      else if (dl >= 7) xpTotal += 20;
      else if (dl >= 4) xpTotal += 10;
      else xpTotal += 5;
    }
  }

  const quest = await completeDailyQuest(questId, {
    score,
    correctCount,
    xpEarned: xpTotal,
    timeElapsedSeconds,
  });

  // The quest's day counts for the streak: record_streak_day stores current/best
  // streak atomically. Then read it back through the configured source.
  const today = getLocalDateString();
  await recordStreakDay(user.id, quest.questDate);
  track("quest_completed", { correct: correctCount, total: answered.length, streak_day: true }, user.id);
  const currentStreak = await getCurrentQuestStreak(user.id);

  await updateUser(clerkId, { totalXp: (user.totalXp ?? 0) + xpTotal });

  const xpBefore = user.totalXp ?? 0;
  const xpAfter = xpBefore + xpTotal;
  const { newBadges, rankUp } = await checkNewUnlocks(user.id, xpBefore, xpAfter);

  // One combined "quest complete" notification (XP, level up, tier, score milestone),
  // deduped via notification_log. Runs after the response is sent.
  after(() =>
    notifyQuestComplete(liveQuestCompleteDeps, {
      user,
      questId,
      xpEarned: xpTotal,
      rankUp,
    }).catch((e) => console.error("Quest-complete notification failed:", e))
  );

  // Pre-generate tomorrow's quest (non-blocking)
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Use local-day string to match how quest dates are read/written elsewhere
    // (getLocalDateString), avoiding a UTC-shift double-generation.
    const tomorrowDate = getLocalDateString(tomorrow);
    await generateQuestForDate(user.id, tomorrowDate);
  } catch (e) {
    // Don't fail the completion if pre-generation fails
    console.error("Failed to pre-generate tomorrow's quest:", e);
  }

  // Sync quest completion to Canvas LMS (non-blocking)
  try {
    const { syncQuestToCanvas } = await import("@/lib/canvas/sync");
    syncQuestToCanvas(user.id, {
      questDate: today,
      correctCount,
      totalQuestions: answered.length,
      xpEarned: xpTotal,
    }).catch((e: unknown) => console.error("Canvas sync error:", e));
  } catch (e) {
    console.error("Canvas sync import error:", e);
  }

  return NextResponse.json({
    quest,
    streak: currentStreak,
    xpEarned: xpTotal,
    newBadges,
    rankUp,
  });
}
