// Plan configuration for Stripe checkout. Price IDs are read from env per plan
// so new plans can be added without touching route code. STRIPE_PRICE_ID is kept
// as a legacy fallback for the monthly plan.
export type PlanId = "monthly" | "annual";

// `price` / `interval` are display-only and must match the Stripe price amounts.
export const PLANS: Record<
  PlanId,
  { label: string; priceEnv: string; price: number; interval: "month" | "year" }
> = {
  monthly: { label: "Monthly", priceEnv: "STRIPE_PRICE_ID_MONTHLY", price: 29, interval: "month" },
  annual: { label: "Annual", priceEnv: "STRIPE_PRICE_ID_ANNUAL", price: 180, interval: "year" },
};

export const DEFAULT_PLAN: PlanId = "monthly";

export function isPlanId(value: unknown): value is PlanId {
  return value === "monthly" || value === "annual";
}

/** Every configured CPA price ID — only subscriptions on these grant access. */
export function getCpaPriceIds(): string[] {
  return (Object.keys(PLANS) as PlanId[])
    .map(getPriceId)
    .filter((id): id is string => !!id);
}

/** Resolves the Stripe price ID for a plan, or null if not configured. */
export function getPriceId(plan: PlanId): string | null {
  const configured = process.env[PLANS[plan].priceEnv];
  if (configured) return configured;
  // Legacy single-price fallback for the default monthly plan.
  if (plan === "monthly") return process.env.STRIPE_PRICE_ID ?? null;
  return null;
}

/** Reverse of getPriceId: which CPA plan a Stripe price belongs to (null if none). */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  return (Object.keys(PLANS) as PlanId[]).find((p) => getPriceId(p) === priceId) ?? null;
}

/**
 * Days a `past_due` subscription keeps Pro access after its first failed payment.
 * Keep Stripe's Smart Retries window (Dashboard → Billing → Revenue recovery) at
 * about the same length, so Stripe gives up around when access ends.
 */
export const GRACE_PERIOD_DAYS = 7;
/** The "your access ends soon" reminder goes out this many days before grace ends. */
export const GRACE_REMINDER_DAYS_BEFORE = 2;
