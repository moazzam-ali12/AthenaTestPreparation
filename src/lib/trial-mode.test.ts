import { test } from "node:test";
import assert from "node:assert/strict";
import { getAccess, getFeatureTier } from "./subscription";
import {
  TRIAL_MODE,
  TUTOR_MESSAGES_PER_DAY_TRIAL,
  TUTOR_MESSAGES_PER_DAY_TRIAL_FULL,
  featureTier,
  hasMicroLessonAccess,
  hasProFeatures,
  hasQuestAccess,
  hasTutorAccess,
  isExpiredAllowedApi,
  isExpiredAllowedPage,
  trialTutorDailyCap,
} from "./trial";
import { decideTbsOpen } from "./tbs/access";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-11T12:00:00Z");
const trialUser = { subscriptionStatus: "free", trialEndsAt: new Date(now.getTime() + 3 * DAY), createdAt: now };

test("the trial ships in full mode", () => {
  assert.equal(TRIAL_MODE, "full");
});

test("hasProFeatures: pro always, trial only in full mode, never expired", () => {
  for (const mode of ["full", "limited"] as const) {
    assert.equal(hasProFeatures("pro", mode), true);
    assert.equal(hasProFeatures("expired", mode), false);
    assert.equal(hasProFeatures(null, mode), false);
    assert.equal(hasProFeatures(undefined, mode), false);
  }
  assert.equal(hasProFeatures("trial", "full"), true);
  assert.equal(hasProFeatures("trial", "limited"), false);
});

test("featureTier: a full-mode trial gates like Pro; limited keeps 'trial'", () => {
  assert.equal(featureTier("trial", "full"), "pro");
  assert.equal(featureTier("trial", "limited"), "trial");
  assert.equal(featureTier("expired", "full"), "expired");
  assert.equal(featureTier(null, "full"), null);
  assert.equal(getAccess(trialUser, now).tier, "trial");
  assert.equal(getFeatureTier(trialUser, now), featureTier("trial"));
});

test("full mode: every feature helper unlocks trial; expired stays locked", () => {
  for (const has of [hasQuestAccess, hasTutorAccess, hasMicroLessonAccess]) {
    assert.equal(has("trial", "full"), true);
    assert.equal(has("expired", "full"), false);
  }
  // A full-mode trial opens any TBS without quota, exactly like Pro.
  const task = { id: "x", isSample: false };
  assert.equal(decideTbsOpen(featureTier("trial", "full"), task, new Set()), "open");
  assert.equal(decideTbsOpen(featureTier("trial", "limited"), task, new Set()), "locked");
});

test("tutor cost guard: full mode uses the full-trial cap, limited the trial cap", () => {
  assert.equal(TUTOR_MESSAGES_PER_DAY_TRIAL_FULL, 100);
  assert.equal(trialTutorDailyCap("full"), TUTOR_MESSAGES_PER_DAY_TRIAL_FULL);
  assert.equal(trialTutorDailyCap("limited"), TUTOR_MESSAGES_PER_DAY_TRIAL);
});

test("expired allow-list: only profile, billing, subscribe, settings, sign-out pages", () => {
  for (const p of ["/profile", "/billing", "/subscribe", "/settings", "/sign-out", "/profile/edit"]) {
    assert.equal(isExpiredAllowedPage(p), true, p);
  }
  for (const p of [
    "/dashboard",
    "/learning",
    "/learning/far/leases",
    "/learning/far/leases/quiz/1",
    "/learning/far/leases/micro-lesson",
    "/practice-exam",
    "/mentor",
    "/review",
    "/queue",
    "/quest/1",
    "/progress",
    "/my-learning",
    "/tangent",
    "/onboarding/plan",
    "/profiles",
    "/subscribed",
  ]) {
    assert.equal(isExpiredAllowedPage(p), false, p);
  }
});

test("expired allow-list: account/billing APIs open, every feature API locked", () => {
  for (const p of [
    "/api/user/me",
    "/api/user/sync",
    "/api/profile",
    "/api/profile/schedule",
    "/api/stripe/checkout",
    "/api/stripe/portal",
    "/api/trial",
    "/api/tutor-preferences",
    "/api/feedback",
    "/api/events",
    "/api/beta/invite",
  ]) {
    assert.equal(isExpiredAllowedApi(p), true, p);
  }
  for (const p of [
    "/api/dashboard",
    "/api/learning",
    "/api/learning/far/leases",
    "/api/act-quiz/answer",
    "/api/practice-exam/start",
    "/api/daily-quest/answer",
    "/api/agent/chat/stream",
    "/api/tbs",
    "/api/progress",
    "/api/learning-queue",
    "/api/goals",
    "/api/onboarding/complete",
    "/api/tracking/micro-lesson-session",
    "/api/profiles",
  ]) {
    assert.equal(isExpiredAllowedApi(p), false, p);
  }
});
