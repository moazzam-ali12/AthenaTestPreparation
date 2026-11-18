import { test } from "node:test";
import assert from "node:assert/strict";
import { getAccess } from "./subscription";
import {
  QUEST_ENABLED_IN_TRIAL,
  TRIAL_DAYS,
  TUTOR_ENABLED_IN_TRIAL,
  hasQuestAccess,
  hasTutorAccess,
  hasMicroLessonAccess,
  MICRO_LESSONS_IN_TRIAL,
  nextUtcMidnight,
  pickSampleProblems,
} from "./trial";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-11T12:00:00Z");
const daysFromNow = (d: number) => new Date(now.getTime() + d * DAY);

test("active Stripe subscription is pro, regardless of trial dates", () => {
  for (const status of ["active", "trialing"]) {
    const access = getAccess(
      { subscriptionStatus: status, trialEndsAt: daysFromNow(-30), createdAt: daysFromNow(-40) },
      now
    );
    assert.equal(access.tier, "pro");
    assert.equal(access.daysLeft, 0);
  }
});

test("new signup is on trial with TRIAL_DAYS left", () => {
  const access = getAccess(
    { subscriptionStatus: "free", trialEndsAt: daysFromNow(TRIAL_DAYS), createdAt: now },
    now
  );
  assert.equal(access.tier, "trial");
  assert.equal(access.daysLeft, TRIAL_DAYS);
});

test("partial last day rounds up to 1 day left", () => {
  const access = getAccess(
    { subscriptionStatus: "free", trialEndsAt: daysFromNow(0.25), createdAt: daysFromNow(-6.75) },
    now
  );
  assert.equal(access.tier, "trial");
  assert.equal(access.daysLeft, 1);
});

test("trial in the past is expired (canceled / past_due too)", () => {
  for (const status of ["free", "canceled", "past_due", "unpaid"]) {
    const access = getAccess(
      { subscriptionStatus: status, trialEndsAt: daysFromNow(-1), createdAt: daysFromNow(-8) },
      now
    );
    assert.equal(access.tier, "expired");
    assert.equal(access.daysLeft, 0);
  }
});

test("trial ending exactly now is expired", () => {
  const access = getAccess({ subscriptionStatus: "free", trialEndsAt: now, createdAt: daysFromNow(-7) }, now);
  assert.equal(access.tier, "expired");
});

test("missing trial_ends_at falls back to created_at + TRIAL_DAYS", () => {
  const recent = getAccess({ subscriptionStatus: "free", trialEndsAt: null, createdAt: daysFromNow(-2) }, now);
  assert.equal(recent.tier, "trial");
  assert.equal(recent.daysLeft, TRIAL_DAYS - 2);
  assert.equal(recent.trialEndsAt?.getTime(), daysFromNow(TRIAL_DAYS - 2).getTime());

  const old = getAccess({ subscriptionStatus: "free", trialEndsAt: null, createdAt: daysFromNow(-30) }, now);
  assert.equal(old.tier, "expired");
});

test("accepts ISO strings (raw Supabase rows) and handles null users", () => {
  const access = getAccess(
    { subscriptionStatus: "free", trialEndsAt: daysFromNow(3).toISOString(), createdAt: "2026-11-01T00:00:00Z" },
    now
  );
  assert.equal(access.tier, "trial");
  assert.equal(access.daysLeft, 3);
  assert.equal(getAccess(null, now).tier, "expired");
});

test("pickSampleProblems spreads evenly and keeps order", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const sample = pickSampleProblems(items, 15);
  assert.equal(sample.length, 15);
  assert.equal(new Set(sample).size, 15);
  assert.equal(sample[0], 0);
  assert.ok(sample[14] >= 45, "reaches the hard end of the exam");
  assert.deepEqual([...sample].sort((a, b) => a - b), sample);
  assert.deepEqual(pickSampleProblems([1, 2, 3], 15), [1, 2, 3]);
});

test("limited mode: daily quest: pro and trial unlocked, expired locked", () => {
  assert.equal(hasQuestAccess("pro", "limited"), true);
  assert.equal(hasQuestAccess("trial", "limited"), QUEST_ENABLED_IN_TRIAL);
  assert.equal(hasQuestAccess("expired", "limited"), false);
  assert.equal(hasQuestAccess(null, "limited"), false);
});

test("limited mode: AI tutor: pro and trial unlocked, expired locked", () => {
  assert.equal(hasTutorAccess("pro", "limited"), true);
  assert.equal(hasTutorAccess("trial", "limited"), TUTOR_ENABLED_IN_TRIAL);
  assert.equal(hasTutorAccess("expired", "limited"), false);
  assert.equal(hasTutorAccess(null, "limited"), false);
  assert.equal(hasTutorAccess(undefined, "limited"), false);
});

test("daily trial quotas reset at the next UTC midnight", () => {
  assert.equal(nextUtcMidnight(now).toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(nextUtcMidnight(new Date("2026-11-11T23:59:59Z")).toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(nextUtcMidnight(new Date("2026-12-31T00:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
});

test("limited mode: micro-lessons: Pro always, trial only while MICRO_LESSONS_IN_TRIAL, never expired", () => {
  assert.equal(hasMicroLessonAccess("pro", "limited"), true);
  assert.equal(hasMicroLessonAccess("trial", "limited"), MICRO_LESSONS_IN_TRIAL);
  assert.equal(hasMicroLessonAccess("expired", "limited"), false);
  assert.equal(hasMicroLessonAccess(null, "limited"), false);
});

// ── Failed-payment grace period ────────────────────────────────────────────────
import { getGraceEndsAt, isGraceReminderDue } from "./subscription";
import { GRACE_PERIOD_DAYS, GRACE_REMINDER_DAYS_BEFORE } from "./plans";
import { currentLockedGap } from "./db/queries/streak-freezes";

const pastDue = (failedDaysAgo: number | null, extra: Record<string, unknown> = {}) => ({
  subscriptionStatus: "past_due",
  trialEndsAt: daysFromNow(-60),
  createdAt: daysFromNow(-67),
  paymentFailedAt: failedDaysAgo === null ? null : daysFromNow(-failedDaysAgo),
  ...extra,
});

test("past_due within grace keeps pro with days left", () => {
  const access = getAccess(pastDue(1), now);
  assert.equal(access.tier, "pro");
  assert.equal(access.graceDaysLeft, GRACE_PERIOD_DAYS - 1);
  assert.equal(access.graceEndsAt?.getTime(), daysFromNow(GRACE_PERIOD_DAYS - 1).getTime());
});

test("past_due just failed has the full grace period", () => {
  const access = getAccess(pastDue(0), now);
  assert.equal(access.tier, "pro");
  assert.equal(access.graceDaysLeft, GRACE_PERIOD_DAYS);
});

test("past_due after grace is expired", () => {
  for (const ago of [GRACE_PERIOD_DAYS, GRACE_PERIOD_DAYS + 3]) {
    const access = getAccess(pastDue(ago), now);
    assert.equal(access.tier, "expired");
    assert.equal(access.graceDaysLeft, 0);
    assert.equal(access.graceEndsAt, null);
  }
});

test("past_due without a recorded failure gets no grace", () => {
  assert.equal(getAccess(pastDue(null), now).tier, "expired");
});

test("unpaid / canceled never get grace, even with a failure time", () => {
  for (const status of ["unpaid", "canceled"]) {
    const access = getAccess(pastDue(1, { subscriptionStatus: status }), now);
    assert.equal(access.tier, "expired");
    assert.equal(getGraceEndsAt(pastDue(1, { subscriptionStatus: status })), null);
  }
});

test("payment recovered (active) is plain pro, no grace fields", () => {
  const access = getAccess(pastDue(3, { subscriptionStatus: "active" }), now);
  assert.equal(access.tier, "pro");
  assert.equal(access.graceDaysLeft, 0);
  assert.equal(access.graceEndsAt, null);
});

test("past_due user still inside their app trial falls back to trial after grace", () => {
  const access = getAccess(pastDue(GRACE_PERIOD_DAYS + 1, { trialEndsAt: daysFromNow(2) }), now);
  assert.equal(access.tier, "trial");
});

test("grace reminder is due only in the last GRACE_REMINDER_DAYS_BEFORE days, once", () => {
  const dueAgo = GRACE_PERIOD_DAYS - GRACE_REMINDER_DAYS_BEFORE; // grace ends in exactly N days
  assert.equal(isGraceReminderDue(pastDue(dueAgo - 0.5), now), false); // too early
  assert.equal(isGraceReminderDue(pastDue(dueAgo), now), true);
  assert.equal(isGraceReminderDue(pastDue(GRACE_PERIOD_DAYS - 0.1), now), true);
  assert.equal(isGraceReminderDue(pastDue(GRACE_PERIOD_DAYS), now), false); // grace over
  assert.equal(isGraceReminderDue(pastDue(dueAgo, { paymentReminderSentAt: now }), now), false);
  assert.equal(isGraceReminderDue(pastDue(dueAgo, { subscriptionStatus: "active" }), now), false);
});

test("locked gap after a lapsed grace starts at grace end, not trial end", () => {
  const user = pastDue(GRACE_PERIOD_DAYS + 3);
  const gap = currentLockedGap(
    {
      trialEndsAt: user.trialEndsAt,
      subscriptionEndDate: daysFromNow(20), // period already advanced by the failed renewal
      graceEndsAt: getGraceEndsAt(user),
    },
    now
  );
  assert.ok(gap);
  // Gap begins the day after grace ended (3 days ago) — not 60 days ago.
  const gapStart = new Date(`${gap!.startDate}T12:00:00Z`).getTime();
  assert.ok(gapStart >= daysFromNow(-4).getTime(), `gap starts ${gap!.startDate}`);
});
