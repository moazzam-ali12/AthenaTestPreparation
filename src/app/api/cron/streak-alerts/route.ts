import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { streakAlertHtml } from "@/lib/email/templates";
import { sendPushToUser } from "@/lib/push";
import { getLocalDateString } from "@/lib/db/queries/daily-quest";
import { getStreakFreezesForUsers } from "@/lib/db/queries/streak-freezes";
import { STREAK_SOURCE, addDays, type StreakSource } from "@/lib/streak";
import {
  deliverStreakAlerts,
  planStreakAlerts,
  type AlertCandidate,
  type StreakAlertPlan,
} from "@/lib/streak-alerts";
import { NextResponse } from "next/server";

// Runs daily at 8 PM UTC (vercel.json: "0 20 * * *")
// Targets users who completed a quest YESTERDAY but NOT today — they have a live streak
// at risk. The streak is the app's own freeze-aware number (src/lib/streak.ts); expired
// users (locked out, streak frozen) get no alert.
// `?dryRun=1` returns the plan ({ userId, streak, wouldEmail }) without sending anything;
// a dry run may also pass `&source=computed|stored` to compare the two streak sources.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const requested = params.get("source");
  const source: StreakSource =
    dryRun && (requested === "stored" || requested === "computed") ? requested : STREAK_SOURCE;

  // Same calendar-day rule as the app's streak (getLocalDateString).
  const now = new Date();
  const today = getLocalDateString(now);
  const yesterdayStr = addDays(today, -1);

  if (source === "stored") return storedModeRun({ today, yesterdayStr, now, dryRun });

  // Users who completed a quest yesterday (they have an active streak ≥ 1)
  const { data: completedYesterday } = await supabase
    .from("daily_quests")
    .select("user_id")
    .eq("quest_date", yesterdayStr)
    .eq("status", "completed");

  if (!completedYesterday?.length) return NextResponse.json({ sent: 0, ...(dryRun ? { dryRun, plan: [] } : {}) });

  // Users who already completed today (streak safe — skip them)
  const { data: completedToday } = await supabase
    .from("daily_quests")
    .select("user_id")
    .eq("quest_date", today)
    .eq("status", "completed");

  const safeSet = new Set((completedToday ?? []).map((q: { user_id: string }) => q.user_id));
  const atRiskIds = [
    ...new Set(completedYesterday.map((q: { user_id: string }) => q.user_id)),
  ].filter((id) => !safeSet.has(id));

  if (!atRiskIds.length) return NextResponse.json({ sent: 0, ...(dryRun ? { dryRun, plan: [] } : {}) });

  // Batch loads (no N+1): full completed history, freezes, and access fields.
  // No date window: a frozen gap can sit inside a long streak, and the app counts all history.
  const [{ data: history }, freezesByUser, { data: users }] = await Promise.all([
    supabase
      .from("daily_quests")
      .select("user_id, quest_date")
      .in("user_id", atRiskIds)
      .eq("status", "completed")
      .lte("quest_date", yesterdayStr),
    getStreakFreezesForUsers(atRiskIds),
    supabase
      .from("users")
      .select("id, email, display_name, subscription_status, trial_ends_at, created_at, payment_failed_at")
      .in("id", atRiskIds),
  ]);

  const datesByUser = new Map<string, string[]>();
  for (const r of (history ?? []) as { user_id: string; quest_date: string }[]) {
    const list = datesByUser.get(r.user_id) ?? [];
    list.push(r.quest_date);
    datesByUser.set(r.user_id, list);
  }

  const candidates: AlertCandidate[] = (users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    subscriptionStatus: u.subscription_status,
    trialEndsAt: u.trial_ends_at,
    createdAt: u.created_at,
    paymentFailedAt: u.payment_failed_at,
  }));

  const plan = planStreakAlerts(candidates, datesByUser, freezesByUser, today, now);
  if (dryRun) return NextResponse.json({ sent: 0, dryRun, source, plan });

  const sent = await deliverStreakAlerts(plan, candidates, deliverAlert);
  return NextResponse.json({ sent });
}

async function deliverAlert(user: AlertCandidate & { email: string }, streak: number) {
  const template = streakAlertHtml({ displayName: user.displayName ?? "there", streak });
  await Promise.allSettled([
    sendEmail({ to: user.email, subject: template.subject, html: template.html }),
    sendPushToUser(user.id, {
      title: "Your streak is at risk! 🔥",
      body: `You're on a ${streak}-day streak — complete today's quest to keep it alive.`,
      url: "/quest",
    }),
  ]);
}

const PAGE = 500;

/**
 * 'stored' mode: no quest-history load. At risk = streak_last_date is yesterday
 * (a quest completed today would have moved it to today). Per page of 500 users:
 * one users query + one freeze query.
 */
async function storedModeRun(opts: { today: string; yesterdayStr: string; now: Date; dryRun: boolean }) {
  const { today, yesterdayStr, now, dryRun } = opts;
  const plan: StreakAlertPlan[] = [];
  let sent = 0;
  for (let from = 0; ; from += PAGE) {
    const { data: users, error } = await (supabase as any)
      .from("users")
      .select("id, email, display_name, subscription_status, trial_ends_at, created_at, payment_failed_at, current_streak, streak_last_date")
      .eq("streak_last_date", yesterdayStr)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
    const rows = (users ?? []) as Record<string, any>[];
    if (rows.length === 0) break;

    const candidates: AlertCandidate[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      subscriptionStatus: u.subscription_status,
      trialEndsAt: u.trial_ends_at,
      createdAt: u.created_at,
      paymentFailedAt: u.payment_failed_at,
      stored: { currentStreak: u.current_streak ?? 0, streakLastDate: u.streak_last_date },
    }));
    const freezesByUser = await getStreakFreezesForUsers(candidates.map((c) => c.id));
    const pagePlan = planStreakAlerts(candidates, null, freezesByUser, today, now, "stored");
    if (dryRun) plan.push(...pagePlan);
    else sent += await deliverStreakAlerts(pagePlan, candidates, deliverAlert);
    if (rows.length < PAGE) break;
  }
  return NextResponse.json(dryRun ? { sent: 0, dryRun, source: "stored", plan } : { sent });
}
