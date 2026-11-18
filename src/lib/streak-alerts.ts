// Pure planning for the streak-alert cron (no I/O): who gets an "at risk" alert and
// with which streak number. The streak comes from streakFromSource — the same
// freeze-aware rule the app shows — so the email can never disagree with the app.
import { streakFromSource, type FreezeRange, type StoredStreak, type StreakSource } from "@/lib/streak";
import { getAccess, type AccessInput } from "@/lib/subscription";

export type AlertCandidate = AccessInput & {
  id: string;
  email: string | null;
  displayName: string | null;
  /** Stored streak columns (needed in 'stored' mode). */
  stored?: StoredStreak | null;
};

export type AlertSkipReason = "expired" | "no_email";

export type StreakAlertPlan = {
  userId: string;
  streak: number;
  wouldEmail: boolean;
  skipReason?: AlertSkipReason;
};

/**
 * Plans alerts for at-risk users (completed a quest yesterday, not yet today).
 * Expired users get nothing: they're locked out and their streak is frozen.
 */
export function planStreakAlerts(
  candidates: readonly AlertCandidate[],
  /** Completed quest dates per user — only needed in 'computed' mode. */
  completedDatesByUser: ReadonlyMap<string, readonly string[]> | null,
  freezesByUser: ReadonlyMap<string, readonly FreezeRange[]>,
  today: string,
  now: Date = new Date(),
  source: StreakSource = "computed"
): StreakAlertPlan[] {
  return candidates.map((u) => {
    const streak = streakFromSource(source, {
      today,
      freezes: freezesByUser.get(u.id) ?? [],
      dates: completedDatesByUser?.get(u.id) ?? [],
      stored: u.stored,
    });
    const skipReason: AlertSkipReason | undefined =
      getAccess(u, now).tier === "expired" ? "expired" : !u.email ? "no_email" : undefined;
    return { userId: u.id, streak, wouldEmail: !skipReason, ...(skipReason ? { skipReason } : {}) };
  });
}

/** Sends the planned alerts through `deliver` (email + push); returns how many were sent. */
export async function deliverStreakAlerts(
  plan: readonly StreakAlertPlan[],
  candidates: readonly AlertCandidate[],
  deliver: (user: AlertCandidate & { email: string }, streak: number) => Promise<unknown>
): Promise<number> {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let sent = 0;
  for (const p of plan) {
    const user = byId.get(p.userId);
    if (!p.wouldEmail || !user?.email) continue;
    await deliver({ ...user, email: user.email }, p.streak);
    sent++;
  }
  return sent;
}
