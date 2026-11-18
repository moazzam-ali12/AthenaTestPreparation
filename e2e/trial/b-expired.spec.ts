// Area B: expired trial — paid surfaces bounce to /subscribe, APIs 402, free pages open, data intact.
import { test, expect, open, signIn } from "../lib/fixtures";
import { closeDb, setUser } from "../lib/db";
import { emailFor } from "../lib/accounts";
import { resetToFreshTrial, subtopicsOf, progressSnapshot } from "../lib/state";
import { buildProgress } from "../lib/flows";

const ROLE = "expired" as const;
let before: Awaited<ReturnType<typeof progressSnapshot>>;

test.beforeAll(async ({ browser }) => {
  await resetToFreshTrial(ROLE);
  const page = await (await browser.newContext()).newPage();
  await signIn(page, ROLE);
  await buildProgress(page, (await subtopicsOf("aud"))[0]);
  await page.context().close();
  before = await progressSnapshot(ROLE);
  await setUser(emailFor(ROLE), "trial_ends_at = now() - interval '1 day'");
});
test.afterAll(closeDb);

test("B progress existed before expiry", async () => {
  expect(before.quizSessions).toBeGreaterThan(0);
  expect(before.quizAnswers).toBeGreaterThan(0);
  expect(before.tbsAttempts).toBeGreaterThan(0);
  expect(before.examAttempts).toBeGreaterThan(0);
  expect(before.total_xp).toBeGreaterThan(0);
});

test("B every app page -> /subscribe?reason=trial_ended with 'progress is saved'", async ({ as }) => {
  const page = await as(ROLE);
  const sub = (await subtopicsOf("aud"))[0];
  const paid = [
    "/dashboard",
    `/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}`,
    "/practice-exam", "/progress", "/quest", "/mentor", "/review", "/queue",
    "/learning", "/my-learning", "/tangent", "/onboarding/plan",
  ];
  for (const path of paid) {
    await open(page, path);
    await expect(page, path).toHaveURL(/\/subscribe\?reason=trial_ended/);
  }
  await expect(page.getByText("Your free trial has ended. Your progress is saved.", { exact: false })).toBeVisible();
  // Saved-progress summary (streak / XP / questions answered) to nudge subscribing.
  const summary = page.getByTestId("saved-progress");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("XP earned")).toBeVisible();
  await expect(summary.getByText(before.total_xp.toLocaleString("en-US"), { exact: true })).toBeVisible();
  // No limited-trial upgrade modal on the paywall.
  await expect(page.getByText("This is a Pro feature")).toHaveCount(0);
});

test("B APIs -> 402 TRIAL_EXPIRED", async ({ as }) => {
  const page = await as(ROLE);
  const sub = (await subtopicsOf("aud"))[0];
  const calls: [string, string, unknown?][] = [
    ["GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}?mode=quiz`],
    ["GET", "/api/tbs?section=aud"],
    ["POST", "/api/practice-exam/start", { section: "AUD" }],
    ["GET", "/api/daily-quest"],
    ["POST", "/api/agent/chat/stream", { question: "hi", lessonTitle: "x", lessonContent: "x" }],
    ["POST", "/api/agent/mentor-chat/stream", { message: "hi" }],
    ["GET", "/api/dashboard"],
    ["GET", "/api/progress"],
    ["GET", "/api/learning"],
  ];
  for (const [m, url, body] of calls) {
    const r = await page.request.fetch(url, { method: m, data: body });
    expect(r.status(), `${m} ${url}`).toBe(402);
    expect((await r.json()).code, url).toBe("TRIAL_EXPIRED");
  }
});

test("B profile, billing, subscribe and settings stay open", async ({ as }) => {
  const page = await as(ROLE);
  for (const path of ["/profile", "/billing", "/subscribe", "/settings"]) {
    await open(page, path);
    await expect(page, path).toHaveURL(new RegExp(`${path}(\\?|$)`));
  }
});

test("B DB: answers, XP, streak, skills, TBS and sample attempts all still there", async () => {
  const after = await progressSnapshot(ROLE);
  expect({ ...after, trialUsage: undefined }).toEqual({ ...before, trialUsage: undefined });
});
