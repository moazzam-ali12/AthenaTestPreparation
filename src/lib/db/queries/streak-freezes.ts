import { supabase } from "@/lib/supabase/client";
import { lockedGap, type FreezeRange } from "@/lib/streak";
import { getLocalDateString } from "@/lib/db/queries/daily-quest";

// streak_freezes is newer than the generated Supabase types.
const db = supabase as unknown as { from: (table: string) => any };

export async function getStreakFreezes(userId: string): Promise<FreezeRange[]> {
  const { data, error } = await db
    .from("streak_freezes")
    .select("start_date, end_date")
    .eq("user_id", userId);
  if (error) {
    // Missing freezes only make a streak shorter; never fail the caller.
    console.error("Failed to load streak freezes:", error);
    return [];
  }
  return ((data ?? []) as { start_date: string; end_date: string }[]).map((r) => ({
    startDate: r.start_date,
    endDate: r.end_date,
  }));
}

/** Freezes for many users in ONE query (batch jobs such as the streak-alert cron). */
export async function getStreakFreezesForUsers(userIds: string[]): Promise<Map<string, FreezeRange[]>> {
  const byUser = new Map<string, FreezeRange[]>();
  if (userIds.length === 0) return byUser;
  const { data, error } = await db
    .from("streak_freezes")
    .select("user_id, start_date, end_date")
    .in("user_id", userIds);
  if (error) {
    console.error("Failed to load streak freezes:", error);
    return byUser;
  }
  for (const r of (data ?? []) as { user_id: string; start_date: string; end_date: string }[]) {
    const list = byUser.get(r.user_id) ?? [];
    list.push({ startDate: r.start_date, endDate: r.end_date });
    byUser.set(r.user_id, list);
  }
  return byUser;
}

/** Idempotent: one freeze per (user, start_date); a retry extends end_date. */
export async function recordStreakFreeze(userId: string, freeze: FreezeRange): Promise<void> {
  const { error } = await db
    .from("streak_freezes")
    .upsert(
      { user_id: userId, start_date: freeze.startDate, end_date: freeze.endDate },
      { onConflict: "user_id,start_date" }
    );
  if (error) throw new Error(`recordStreakFreeze failed: ${error.message}`);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The locked-out gap of an EXPIRED user, from the day access ended (the later
 * of trial end and previous subscription end) through today. Recorded as a
 * freeze on reactivation; also used to show an expired user their saved streak.
 */
export function currentLockedGap(
  ends: {
    trialEndsAt: Date | string | null | undefined;
    subscriptionEndDate: Date | string | null | undefined;
    /** End of a lapsed failed-payment grace period (past_due → expired). */
    graceEndsAt?: Date | string | null;
  },
  now: Date = new Date()
): FreezeRange | null {
  const times = [toDate(ends.trialEndsAt), toDate(ends.subscriptionEndDate), toDate(ends.graceEndsAt)]
    .filter((d): d is Date => !!d && d.getTime() <= now.getTime())
    .map((d) => d.getTime());
  if (times.length === 0) return null;
  return lockedGap(getLocalDateString(new Date(Math.max(...times))), getLocalDateString(now));
}
