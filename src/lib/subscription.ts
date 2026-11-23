import { TRIAL_DAYS, featureTier, type AccessTier } from "./trial";
import { GRACE_PERIOD_DAYS, GRACE_REMINDER_DAYS_BEFORE } from "./plans";

// Subscription statuses (from Stripe) that unlock paid features.
export function hasProAccess(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessInput = {
  subscriptionStatus: string | null | undefined;
  trialEndsAt: Date | string | null | undefined;
  /** Fallback trial anchor for rows that predate the trial columns. */
  createdAt: Date | string | null | undefined;
  /** First failed payment of the current past_due spell (users.payment_failed_at). */
  paymentFailedAt?: Date | string | null;
};

export type Access = {
  tier: AccessTier;
  trialEndsAt: Date | null;
  /** Whole days left in the trial, rounded up (0 unless tier is 'trial'). */
  daysLeft: number;
  /** Set while a past_due subscription is in its grace period (tier is 'pro'). */
  graceEndsAt: Date | null;
  /** Whole days of grace left, rounded up (0 unless in grace). */
  graceDaysLeft: number;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Single source of truth for what a user may access. */
export function getAccess(user: AccessInput | null | undefined, now: Date = new Date()): Access {
  const createdAt = toDate(user?.createdAt);
  const trialEndsAt =
    toDate(user?.trialEndsAt) ??
    (createdAt ? new Date(createdAt.getTime() + TRIAL_DAYS * DAY_MS) : null);

  const noGrace = { graceEndsAt: null, graceDaysLeft: 0 };

  if (user && hasProAccess(user.subscriptionStatus)) {
    return { tier: "pro", trialEndsAt, daysLeft: 0, ...noGrace };
  }
  const graceEndsAt = getGraceEndsAt(user);
  if (graceEndsAt && now.getTime() < graceEndsAt.getTime()) {
    const graceDaysLeft = Math.ceil((graceEndsAt.getTime() - now.getTime()) / DAY_MS);
    return { tier: "pro", trialEndsAt, daysLeft: 0, graceEndsAt, graceDaysLeft };
  }
  if (trialEndsAt && now.getTime() < trialEndsAt.getTime()) {
    const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS);
    return { tier: "trial", trialEndsAt, daysLeft, ...noGrace };
  }
  return { tier: "expired", trialEndsAt, daysLeft: 0, ...noGrace };
}

/**
 * End of the failed-payment grace period: only a `past_due` subscription (Stripe is
 * still retrying) with a recorded first failure gets one. `unpaid`/`canceled` never do.
 */
export function getGraceEndsAt(user: AccessInput | null | undefined): Date | null {
  if (user?.subscriptionStatus !== "past_due") return null;
  const failedAt = toDate(user.paymentFailedAt);
  return failedAt ? new Date(failedAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS) : null;
}

/**
 * True when the "your access ends soon" email is due: still in grace, within
 * GRACE_REMINDER_DAYS_BEFORE days of its end, and not yet sent for this spell.
 */
export function isGraceReminderDue(
  user: AccessInput & { paymentReminderSentAt?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (toDate(user.paymentReminderSentAt)) return false;
  const graceEndsAt = getGraceEndsAt(user);
  if (!graceEndsAt) return false;
  const msLeft = graceEndsAt.getTime() - now.getTime();
  return msLeft > 0 && msLeft <= GRACE_REMINDER_DAYS_BEFORE * DAY_MS;
}

/**
 * The tier server routes gate features on: a full-mode trial user counts as
 * "pro" (see hasProFeatures in ./trial). Use getAccess for banners/billing.
 */
export function getFeatureTier(user: AccessInput | null | undefined, now: Date = new Date()): AccessTier {
  return featureTier(getAccess(user, now).tier);
}
