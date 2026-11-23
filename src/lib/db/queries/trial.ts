import { supabase } from "@/lib/supabase/client";
import { isCpaSubject, type CpaSubject } from "@/types/cpa-exam";
import {
  TRIAL_LIMITS,
  nextUtcMidnight,
  type TrialDailyKind,
  type TrialItemKind,
  type TrialUsageResponse,
  type TutorDailyUsage,
} from "@/lib/trial";

export type ConsumeResult = { allowed: boolean; remaining: number; alreadyConsumed: boolean };

/**
 * Atomically records that a trial user opened `itemId` (see the
 * consume_trial_item SQL function). Re-opening an already-consumed item is
 * always allowed and costs nothing.
 */
export async function consumeTrialItem(
  userId: string,
  section: CpaSubject,
  kind: TrialItemKind,
  itemId: string
): Promise<ConsumeResult> {
  const { data, error } = await supabase.rpc("consume_trial_item", {
    p_user_id: userId,
    p_section: section,
    p_kind: kind,
    p_item_id: itemId,
    p_max: TRIAL_LIMITS[kind],
  });
  if (error) throw new Error(`consume_trial_item failed: ${error.message}`);
  const row = data?.[0];
  if (!row) throw new Error("consume_trial_item returned no row");
  return { allowed: row.allowed, remaining: row.remaining, alreadyConsumed: row.already_consumed };
}

/** Item IDs of `kind` the user has already consumed (optionally per section). */
export async function getConsumedItemIds(
  userId: string,
  kind: TrialItemKind,
  section?: CpaSubject
): Promise<Set<string>> {
  let query = supabase.from("trial_usage").select("item_id").eq("user_id", userId).eq("kind", kind);
  if (section) query = query.eq("section", section);
  const { data, error } = await query;
  if (error) throw new Error(`trial_usage read failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.item_id));
}

/** Per-section usage counts for the trial banner / section badges. */
export async function getTrialUsage(userId: string): Promise<TrialUsageResponse["usage"]> {
  const { data, error } = await supabase
    .from("trial_usage")
    .select("section, kind")
    .eq("user_id", userId);
  if (error) throw new Error(`trial_usage read failed: ${error.message}`);

  const usage: TrialUsageResponse["usage"] = { mcq: {}, tbs: {}, sampleTests: 0 };
  for (const row of data ?? []) {
    if (row.kind === "sample_test") {
      usage.sampleTests += 1;
    } else if ((row.kind === "mcq" || row.kind === "tbs") && isCpaSubject(row.section)) {
      usage[row.kind][row.section] = (usage[row.kind][row.section] ?? 0) + 1;
    }
  }
  return usage;
}

export type DailyConsumeResult = { allowed: boolean; remaining: number; usageDay: string };

/**
 * Atomically uses one unit of today's (UTC) `kind` quota (see the
 * consume_trial_daily SQL function). Never exceeds `max`, even under races.
 */
export async function consumeTrialDaily(
  userId: string,
  kind: TrialDailyKind,
  max: number
): Promise<DailyConsumeResult> {
  const { data, error } = await supabase.rpc("consume_trial_daily", {
    p_user_id: userId,
    p_kind: kind,
    p_max: max,
  });
  if (error) throw new Error(`consume_trial_daily failed: ${error.message}`);
  const row = data?.[0];
  if (!row) throw new Error("consume_trial_daily returned no row");
  return { allowed: row.allowed, remaining: row.remaining, usageDay: row.usage_day };
}

/** Gives back one unit consumed on `usageDay` (e.g. the LLM call failed). */
export async function refundTrialDaily(userId: string, kind: TrialDailyKind, usageDay: string) {
  const { error } = await supabase.rpc("refund_trial_daily", {
    p_user_id: userId,
    p_kind: kind,
    p_day: usageDay,
  });
  if (error) console.error(`refund_trial_daily failed: ${error.message}`);
}

/** Today's (UTC) usage of a daily trial quota. */
export async function getTrialDailyUsage(
  userId: string,
  kind: TrialDailyKind,
  limit: number,
  now: Date = new Date()
): Promise<TutorDailyUsage> {
  const { data, error } = await supabase
    .from("trial_daily_usage")
    .select("used")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("usage_date", now.toISOString().slice(0, 10))
    .maybeSingle();
  if (error) throw new Error(`trial_daily_usage read failed: ${error.message}`);
  const used = data?.used ?? 0;
  return { used, limit, remaining: Math.max(limit - used, 0), resetsAt: nextUtcMidnight(now).toISOString() };
}
