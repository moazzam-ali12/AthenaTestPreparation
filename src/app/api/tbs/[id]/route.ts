import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getApprovedTbs, getOrCreateInProgressAttempt, toPublicTask } from "@/lib/db/queries/tbs";
import { consumeTrialItem, getConsumedItemIds } from "@/lib/db/queries/trial";
import { getFeatureTier } from "@/lib/subscription";
import { trialLimitResponse } from "@/lib/trial-gate";
import { decideTbsOpen } from "@/lib/tbs/access";
import type { TbsOpenResponse } from "@/lib/tbs/schema";

/**
 * GET /api/tbs/[id] — the task WITHOUT its answer key, plus the user's
 * in-progress attempt (resumed or started). Trial users spend their per-section
 * TBS quota on first open; re-opening a consumed task is free.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { id } = await params;
  const task = await getApprovedTbs(id);
  if (!task) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });

  const tier = getFeatureTier(user);
  const consumed =
    tier === "pro" ? new Set<string>() : await getConsumedItemIds(user.id, "tbs", task.section);
  const decision = decideTbsOpen(tier, task, consumed);
  if (decision === "locked") return trialLimitResponse("tbs", task.section);
  if (decision === "consume") {
    const result = await consumeTrialItem(user.id, task.section, "tbs", task.id);
    if (!result.allowed) return trialLimitResponse("tbs", task.section);
  }

  const attempt = await getOrCreateInProgressAttempt(user.id, task.id);
  const body: TbsOpenResponse = { task: toPublicTask(task), attempt };
  return NextResponse.json(body);
}
