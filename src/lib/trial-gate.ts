// Server-only 402 responses for the free trial. Shared by middleware and API routes.
import { NextResponse } from "next/server";
import type { CpaSubject } from "@/types/cpa-exam";
import {
  PRICING_PATH,
  TRIAL_ENDED_PATH,
  TRIAL_ERROR_CODES,
  type TrialItemKind,
  type TrialLimitBody,
  type TrialTutorLimitBody,
} from "@/lib/trial";

export function trialLimitResponse(kind: TrialItemKind, section: CpaSubject | null) {
  const body: TrialLimitBody = {
    error: "Free trial limit reached",
    code: TRIAL_ERROR_CODES.limit,
    kind,
    section,
    remaining: 0,
    upgradeUrl: PRICING_PATH,
  };
  return NextResponse.json(body, { status: 402 });
}

export function featureLockedResponse() {
  return NextResponse.json(
    { error: "This feature requires a subscription", code: TRIAL_ERROR_CODES.locked, upgradeUrl: PRICING_PATH },
    { status: 402 }
  );
}

export function trialExpiredResponse() {
  return NextResponse.json(
    { error: "Your free trial has ended", code: TRIAL_ERROR_CODES.expired, upgradeUrl: TRIAL_ENDED_PATH },
    { status: 402 }
  );
}

export function trialTutorLimitResponse(resetsAt: Date) {
  const body: TrialTutorLimitBody = {
    error: "Daily AI tutor limit reached",
    code: TRIAL_ERROR_CODES.tutorLimit,
    remaining: 0,
    resetsAt: resetsAt.toISOString(),
    upgradeUrl: PRICING_PATH,
  };
  return NextResponse.json(body, { status: 402 });
}
