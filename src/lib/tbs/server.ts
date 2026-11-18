// Shared server-side loading for the TBS attempt/submit routes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovedTbs, getInProgressAttempt, type TbsTaskRow } from "@/lib/db/queries/tbs";
import { getConsumedItemIds } from "@/lib/db/queries/trial";
import { getFeatureTier, type AccessInput } from "@/lib/subscription";
import { trialLimitResponse } from "@/lib/trial-gate";
import { tbsResponsesSchema, type TbsAttemptState, type TbsResponses } from "@/lib/tbs/schema";

export const attemptBodySchema = z.object({
  responses: tbsResponsesSchema,
  timeSpentSeconds: z.number().int().min(0).max(24 * 60 * 60),
});

/** Keeps only responses for the task's own fields. */
export function pickTaskResponses(task: TbsTaskRow, responses: TbsResponses): TbsResponses {
  const ids = new Set(task.fields.map((f) => f.id));
  return Object.fromEntries(Object.entries(responses).filter(([k]) => ids.has(k)));
}

/**
 * Loads the task and the user's in-progress attempt, enforcing that trial
 * users only touch tasks they've legitimately opened (consumed).
 */
export async function loadTaskAndAttempt(
  user: AccessInput & { id: string },
  tbsId: string
): Promise<{ task: TbsTaskRow; attempt: TbsAttemptState } | NextResponse> {
  const task = await getApprovedTbs(tbsId);
  if (!task) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  if (getFeatureTier(user) !== "pro") {
    const consumed = await getConsumedItemIds(user.id, "tbs", task.section);
    if (!consumed.has(task.id)) return trialLimitResponse("tbs", task.section);
  }

  const attempt = await getInProgressAttempt(user.id, task.id);
  if (!attempt) {
    return NextResponse.json({ error: "No attempt in progress — reopen the simulation" }, { status: 409 });
  }
  return { task, attempt };
}
