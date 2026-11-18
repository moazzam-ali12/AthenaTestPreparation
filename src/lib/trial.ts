// Free-trial configuration — the single source of truth for every trial limit.
// Middleware, API routes and UI all read from here; never hard-code these.
// Client-safe: no server imports.
import type { CpaSubject } from "@/types/cpa-exam";

export const TRIAL_DAYS = 7;

/**
 * 'full'    — trial users get every Pro feature for TRIAL_DAYS (no quotas, no
 *             sample tests, no upgrade modals); only the AI-tutor cost guard
 *             (TUTOR_MESSAGES_PER_DAY_TRIAL_FULL) applies.
 * 'limited' — the quota-based trial configured by the constants below.
 * Every gate goes through hasProFeatures(); don't branch on this elsewhere.
 */
export type TrialMode = "full" | "limited";
export const TRIAL_MODE: TrialMode = "full";
/** Distinct quiz MCQs a trial user may open per CPA section. */
export const MCQ_PER_SECTION = 10;
/** Sample Task-Based Simulations per CPA section. */
export const TBS_PER_SECTION = 1;
/** Sample practice tests per account (not per section). */
export const SAMPLE_TESTS = 1;
/** Question count of the short sample practice test. */
export const SAMPLE_TEST_QUESTIONS = 15;
/** Time budget per sample-test question; drives the sample timer. */
export const SAMPLE_TEST_MINUTES_PER_QUESTION = 1.6;
/** Sample test time limit, derived from its question count (15 → 24 min). */
export const SAMPLE_TEST_MINUTES = Math.ceil(SAMPLE_TEST_QUESTIONS * SAMPLE_TEST_MINUTES_PER_QUESTION);
/** Trial users get the full daily quest (generation, grading, XP, streaks). */
export const QUEST_ENABLED_IN_TRIAL = true;
/** When true, each new quest MCQ a trial user answers draws on the per-section MCQ quota. */
export const QUEST_COUNTS_TOWARD_MCQ_QUOTA = false;
/** Trial users get the AI tutor (quiz/quest tutor, floating tutor, AI quiz summary). Mentor stays Pro-only. */
export const TUTOR_ENABLED_IN_TRIAL = true;
/** Tutor messages a trial user may send per UTC day (Pro is unlimited). */
export const TUTOR_MESSAGES_PER_DAY_TRIAL = 20;
/** Trial users get micro-lessons (page + APIs, and the 2-misses-in-practice redirect). */
export const MICRO_LESSONS_IN_TRIAL = false;
/** Full-mode AI tutor cost guard: messages per UTC day for trial users (null = unlimited). */
export const TUTOR_MESSAGES_PER_DAY_TRIAL_FULL: number | null = 100;

export type AccessTier = "pro" | "trial" | "expired";
export type TrialItemKind = "mcq" | "tbs" | "sample_test";
/** Per-day trial counters (trial_daily_usage table). */
export type TrialDailyKind = "tutor_msg";

type Tier = AccessTier | null | undefined;

/**
 * THE trial switch: true when this tier gets exactly what Pro gets — Pro
 * always, trial while TRIAL_MODE is 'full', never once expired.
 */
export function hasProFeatures(tier: Tier, mode: TrialMode = TRIAL_MODE): boolean {
  return tier === "pro" || (tier === "trial" && mode === "full");
}

/**
 * The tier to gate features on: a full-mode trial user is treated as Pro.
 * Banners/billing copy should keep using the real tier.
 */
export function featureTier<T extends Tier>(tier: T, mode: TrialMode = TRIAL_MODE): T | "pro" {
  return hasProFeatures(tier, mode) ? "pro" : tier;
}

/** Daily quest: Pro features, or a limited trial while QUEST_ENABLED_IN_TRIAL. */
export function hasQuestAccess(tier: Tier, mode: TrialMode = TRIAL_MODE): boolean {
  return hasProFeatures(tier, mode) || (tier === "trial" && QUEST_ENABLED_IN_TRIAL);
}

/** AI tutor: Pro features, or a limited trial while TUTOR_ENABLED_IN_TRIAL. */
export function hasTutorAccess(tier: Tier, mode: TrialMode = TRIAL_MODE): boolean {
  return hasProFeatures(tier, mode) || (tier === "trial" && TUTOR_ENABLED_IN_TRIAL);
}

/** Micro-lessons: Pro features, or a limited trial while MICRO_LESSONS_IN_TRIAL. */
export function hasMicroLessonAccess(tier: Tier, mode: TrialMode = TRIAL_MODE): boolean {
  return hasProFeatures(tier, mode) || (tier === "trial" && MICRO_LESSONS_IN_TRIAL);
}

/**
 * Daily AI-tutor message cap for a trial user in this mode; null = uncapped.
 * (Pro is never capped; expired users never reach the tutor.)
 */
export function trialTutorDailyCap(mode: TrialMode = TRIAL_MODE): number | null {
  if (mode === "full") return TUTOR_MESSAGES_PER_DAY_TRIAL_FULL;
  return TUTOR_ENABLED_IN_TRIAL ? TUTOR_MESSAGES_PER_DAY_TRIAL : null;
}

/** Daily trial quotas reset at UTC midnight (same as the server-side quest date). */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export const TRIAL_LIMITS: Record<TrialItemKind, number> = {
  mcq: MCQ_PER_SECTION,
  tbs: TBS_PER_SECTION,
  sample_test: SAMPLE_TESTS,
};

/** `code` values on 402 responses; the client upgrade modal keys off these. */
export const TRIAL_ERROR_CODES = {
  limit: "TRIAL_LIMIT",
  locked: "FEATURE_LOCKED",
  expired: "TRIAL_EXPIRED",
  tutorLimit: "TRIAL_TUTOR_LIMIT",
} as const;

export type TrialErrorCode = (typeof TRIAL_ERROR_CODES)[keyof typeof TRIAL_ERROR_CODES];

export type TrialLimitBody = {
  error: string;
  code: typeof TRIAL_ERROR_CODES.limit;
  kind: TrialItemKind;
  section: CpaSubject | null;
  remaining: 0;
  upgradeUrl: string;
};

export type TrialTutorLimitBody = {
  error: string;
  code: typeof TRIAL_ERROR_CODES.tutorLimit;
  remaining: 0;
  /** ISO time the daily cap resets (next UTC midnight). */
  resetsAt: string;
  upgradeUrl: string;
};

export type TutorDailyUsage = { used: number; limit: number; remaining: number; resetsAt: string };

export type TrialUsageResponse = {
  tier: AccessTier;
  trialEndsAt: string | null;
  daysLeft: number;
  limits: Record<TrialItemKind, number>;
  /** Distinct items used, per section (sample tests are account-wide). */
  usage: {
    mcq: Partial<Record<CpaSubject, number>>;
    tbs: Partial<Record<CpaSubject, number>>;
    sampleTests: number;
  };
  /** Today's AI tutor messages; null for Pro or when the tutor is not part of the trial. */
  tutor: TutorDailyUsage | null;
};

/**
 * Picks `count` problems spread evenly across an exam's ordered problem list.
 * Exams ramp in difficulty across modules, so an even stride yields a mixed
 * easy → hard sample while keeping the exam's original order.
 */
export function pickSampleProblems<T>(problems: readonly T[], count: number): T[] {
  if (problems.length <= count) return [...problems];
  const step = problems.length / count;
  return Array.from({ length: count }, (_, i) => problems[Math.floor(i * step)]);
}

export const PRICING_PATH = "/subscribe";
export const TRIAL_ENDED_PATH = `${PRICING_PATH}?reason=trial_ended`;

// ── Expired = everything locked ──
// Once the trial (or a subscription) has ended, ONLY these stay reachable;
// every other app page redirects to TRIAL_ENDED_PATH and every other API
// answers 402 TRIAL_EXPIRED (see src/middleware.ts). No data is deleted.

/** App pages an expired user may still open (account, billing, the paywall). */
export const EXPIRED_ALLOWED_PAGES: readonly RegExp[] = [
  /^\/profile(\/|$)/,
  /^\/billing(\/|$)/,
  /^\/subscribe(\/|$)/,
  /^\/settings(\/|$)/,
  /^\/sign-out(\/|$)/,
];

/** APIs those pages (and the app shell) need. Webhooks/cron carry no Clerk session and never reach the tier check. */
export const EXPIRED_ALLOWED_APIS: readonly RegExp[] = [
  /^\/api\/user\//, // /api/user/me, /api/user/sync (nav, access)
  /^\/api\/profile(\/|$)/, // profile page + paywall progress summary
  /^\/api\/stripe\//, // checkout, portal, webhook
  /^\/api\/trial\/?$/,
  /^\/api\/push(\/|$)/, // notification settings
  /^\/api\/tutor-preferences\/?$/, // read by the app-wide tutor provider on every page
  /^\/api\/canvas(\/|$)/, // settings page integration (account config, not study content)
  /^\/api\/health\/?$/,
  /^\/api\/cron\//,
  /^\/api\/feedback\/?$/, // in-app feedback button (beta)
  /^\/api\/events\/?$/, // paywall_viewed analytics from the pricing page
  /^\/api\/beta\/invite\/?$/, // invite-code check on /sign-up
];

export function isExpiredAllowedPage(pathname: string): boolean {
  return EXPIRED_ALLOWED_PAGES.some((re) => re.test(pathname));
}

export function isExpiredAllowedApi(pathname: string): boolean {
  return EXPIRED_ALLOWED_APIS.some((re) => re.test(pathname));
}
