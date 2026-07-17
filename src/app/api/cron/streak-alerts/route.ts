import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { streakAlertHtml } from "@/lib/email/templates";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

// Runs daily at 8 PM UTC (vercel.json: "0 20 * * *")
// Targets users who completed a quest YESTERDAY but NOT today — they have a live streak
// at risk. Computes each user's real current streak before sending.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // Users who completed a quest yesterday (they have an active streak ≥ 1)
  const { data: completedYesterday } = await supabase
    .from("daily_quests")
    .select("user_id")
    .eq("quest_date", yesterdayStr)
    .eq("status", "completed");

  if (!completedYesterday?.length) return NextResponse.json({ sent: 0 });

  // Users who already completed today (streak safe — skip them)
  const { data: completedToday } = await supabase
    .from("daily_quests")
    .select("user_id")
    .eq("quest_date", today)
    .eq("status", "completed");

  const safeSet = new Set((completedToday ?? []).map((q: { user_id: string }) => q.user_id));
  const atRiskIds = [
    ...new Set((completedYesterday).map((q: { user_id: string }) => q.user_id)),
  ].filter((id) => !safeSet.has(id));

  if (!atRiskIds.length) return NextResponse.json({ sent: 0 });

  // Fetch recent quest history (up to 60 days) for at-risk users in one query
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(now.getDate() - 60);
  const sixtyDaysAgoStr = sixtyDaysAgo.toISOString().split("T")[0];

  const { data: recentHistory } = await supabase
    .from("daily_quests")
    .select("user_id, quest_date")
    .in("user_id", atRiskIds)
    .eq("status", "completed")
    .gte("quest_date", sixtyDaysAgoStr)
    .lte("quest_date", yesterdayStr)
    .order("quest_date", { ascending: false });

  // Group by user and compute current streak (consecutive days back from yesterday)
  const historyByUser = new Map<string, string[]>();
  for (const row of recentHistory ?? []) {
    const r = row as { user_id: string; quest_date: string };
    if (!historyByUser.has(r.user_id)) historyByUser.set(r.user_id, []);
    historyByUser.get(r.user_id)!.push(r.quest_date);
  }

  function computeStreak(dates: string[], anchor: string): number {
    let streak = 0;
    for (const dateStr of dates) {
      const expected = new Date(anchor);
      expected.setDate(expected.getDate() - streak);
      const diff = Math.round(
        (expected.getTime() - new Date(dateStr).getTime()) / 86_400_000
      );
      if (diff === 0) streak++;
      else break;
    }
    return streak;
  }

  // Get user emails
  const { data: users } = await supabase
    .from("users")
    .select("id, email, display_name")
    .in("id", atRiskIds)
    .not("email", "is", null);

  const userMap = new Map(
    (users ?? []).map((u: { id: string; email: string; display_name: string | null }) => [u.id, u])
  );

  let sent = 0;
  for (const userId of atRiskIds) {
    const user = userMap.get(userId);
    if (!user?.email) continue;

    const dates = historyByUser.get(userId) ?? [];
    const streak = Math.max(1, computeStreak(dates, yesterdayStr));

    const template = streakAlertHtml({
      displayName: user.display_name ?? "there",
      streak,
    });

    await Promise.allSettled([
      sendEmail({ to: user.email, subject: template.subject, html: template.html }),
      sendPushToUser(userId, {
        title: "Your streak is at risk! 🔥",
        body: `You're on a ${streak}-day streak — complete today's quest to keep it alive.`,
        url: "/quest",
      }),
    ]);
    sent++;
  }

  return NextResponse.json({ sent });
}
