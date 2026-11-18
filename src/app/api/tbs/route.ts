import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getUserTbsStats, listApprovedTbs } from "@/lib/db/queries/tbs";
import { getConsumedItemIds } from "@/lib/db/queries/trial";
import { getFeatureTier } from "@/lib/subscription";
import { isTbsLocked } from "@/lib/tbs/access";
import type { TbsListItem } from "@/lib/tbs/schema";
import { isCpaSubject } from "@/types/cpa-exam";

/** GET /api/tbs?section=aud — approved simulations for a section. */
export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const section = new URL(req.url).searchParams.get("section")?.toLowerCase();
  if (!isCpaSubject(section)) {
    return NextResponse.json({ error: "Valid section is required" }, { status: 400 });
  }

  const tier = getFeatureTier(user);
  const tasks = await listApprovedTbs(section);
  const [stats, consumed] = await Promise.all([
    getUserTbsStats(user.id, tasks.map((t) => t.id)),
    tier === "pro" ? Promise.resolve(new Set<string>()) : getConsumedItemIds(user.id, "tbs", section),
  ]);

  const items: TbsListItem[] = tasks.map((t) => {
    const stat = stats.get(t.id);
    return {
      id: t.id,
      title: t.title,
      subtopicName: t.subtopicName,
      difficulty: t.difficulty,
      estMinutes: t.estMinutes,
      isSample: t.isSample,
      locked: isTbsLocked(tier, t, consumed),
      status: stat?.status ?? "not_started",
      bestPercent: stat?.bestPercent ?? null,
    };
  });

  return NextResponse.json({ section, tasks: items });
}
