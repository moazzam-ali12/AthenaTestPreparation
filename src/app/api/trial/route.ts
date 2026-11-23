import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getTrialDailyUsage, getTrialUsage } from "@/lib/db/queries/trial";
import { getAccess } from "@/lib/subscription";
import { TRIAL_LIMITS, hasProFeatures, trialTutorDailyCap, type TrialUsageResponse } from "@/lib/trial";

/** Access tier + free-trial usage for the banner and per-section counters. */
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const access = getAccess(user);
  // Full-mode trial users have Pro features: no quotas to report.
  const proFeatures = hasProFeatures(access.tier);
  const usage = proFeatures ? { mcq: {}, tbs: {}, sampleTests: 0 } : await getTrialUsage(user.id);
  const tutorCap = trialTutorDailyCap();
  const tutor =
    access.tier === "trial" && tutorCap !== null
      ? await getTrialDailyUsage(user.id, "tutor_msg", tutorCap)
      : null;

  const body: TrialUsageResponse = {
    tier: access.tier,
    trialEndsAt: access.trialEndsAt?.toISOString() ?? null,
    daysLeft: access.daysLeft,
    limits: TRIAL_LIMITS,
    usage,
    tutor,
  };
  return NextResponse.json(body);
}
