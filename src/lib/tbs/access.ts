// Pure TBS access rules for the free trial (quota itself is enforced
// atomically by consume_trial_item). Client-safe.
import type { AccessTier } from "@/lib/trial";

export type TbsOpenDecision =
  /** Pro, or a trial user re-opening a task already consumed: no quota cost. */
  | "open"
  /** Trial user opening the section sample for the first time: consume quota. */
  | "consume"
  /** Trial user asking for a non-sample task they haven't opened: 402. */
  | "locked";

export function decideTbsOpen(
  tier: AccessTier,
  task: { id: string; isSample: boolean },
  consumedIds: ReadonlySet<string>
): TbsOpenDecision {
  if (tier === "pro") return "open";
  if (consumedIds.has(task.id)) return "open";
  return task.isSample ? "consume" : "locked";
}

/** Whether a task shows as locked in the list (trial users only). */
export function isTbsLocked(
  tier: AccessTier,
  task: { id: string; isSample: boolean },
  consumedIds: ReadonlySet<string>
): boolean {
  return decideTbsOpen(tier, task, consumedIds) === "locked";
}
