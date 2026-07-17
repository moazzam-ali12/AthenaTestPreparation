import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { completeDailyQuest, getCurrentQuestStreak, getLocalDateString } from "@/lib/db/queries/daily-quest";
import { generateQuestForDate } from "@/lib/adaptive/generate-quest";
import { checkNewUnlocks } from "@/lib/gamification/check-unlocks";
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

  // Calculate current streak from completed quest history (includes the quest we just completed)
  const today = getLocalDateString();
  const currentStreak = await getCurrentQuestStreak(user.id);

  const updates: Record<string, number> = {
    totalXp: (user.totalXp ?? 0) + xpTotal,
  };

  // Update best_streak if current streak exceeds it
  if (currentStreak > (user.bestStreak ?? 0)) {
    updates.bestStreak = currentStreak;
  }

  await updateUser(clerkId, updates);

  const xpBefore = user.totalXp ?? 0;
  const xpAfter = xpBefore + xpTotal;
  const { newBadges, rankUp } = await checkNewUnlocks(user.id, xpBefore, xpAfter);

  // Pre-generate tomorrow's quest (non-blocking)
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split("T")[0];
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
