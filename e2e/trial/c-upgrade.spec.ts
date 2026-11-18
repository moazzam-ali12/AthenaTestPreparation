// Area C: real Stripe test checkouts (expired -> Monthly, trial -> Annual, pro -> Monthly), webhook
// effects, idempotent replay, and cancellation. Runs once (desktop project only).
import { test, expect, api, open } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { localDaysAgo, progressSnapshot, resetToFreshTrial, seedQuestStreak, subtopicsOf, userRow } from "../lib/state";
import { buildProgress } from "../lib/flows";
import { payHostedCheckout, replayEvent, stripe } from "../lib/stripe";
import type { Page } from "@playwright/test";
import type { Role } from "../lib/accounts";

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "Stripe checkouts run once, on desktop");
  test.skip(!!process.env.E2E_SKIP_CHECKOUT, "checkouts already done (E2E_SKIP_CHECKOUT)");
});
test.describe.configure({ mode: "serial" });
test.afterAll(closeDb);

async function checkout(page: Page, plan: "Monthly" | "Annual") {
  await open(page, "/subscribe");
  await page.getByRole("button", { name: new RegExp(`^${plan}`) }).first().click();
  await page.getByRole("button", { name: "Subscribe Now" }).click();
  await payHostedCheckout(page);
  await expect(page).toHaveURL(/\/subscribe\?.*checkout=success/);
  await expect(page.getByRole("button", { name: "You're subscribed" })).toBeVisible({ timeout: 60_000 });
}

async function expectFullAccess(page: Page, role: Role) {
  const u = await userRow(role);
  expect(u.subscription_status).toBe("active");
  expect(u.plan_type).toBe("pro");
  expect((await api(page, "GET", "/api/trial")).body.tier).toBe("pro");
  await open(page, "/dashboard");
  await expect(page.getByText(/Free trial:/)).toHaveCount(0);
  const sub = (await subtopicsOf("aud"))[0];
  const quiz = await api(page, "GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}?mode=quiz`);
  expect(quiz.status).toBe(200);
  expect(quiz.body.problems.length, "no 10-question trial cap").toBeGreaterThan(10);
  for (const path of ["/mentor", "/practice-exam", "/progress"]) {
    await open(page, path);
    await expect(page, path).toHaveURL(new RegExp(path));
  }
}

test("C expired -> Pro (Monthly): subscribed, full access, all earlier progress kept", async ({ as }) => {
  const role = "expired" as const;
  let before = await progressSnapshot(role);
  if (before.quizSessions === 0) {
    // Area B normally leaves progress behind; rebuild it if C runs alone.
    await resetToFreshTrial(role);
    const p0 = await as(role);
    await buildProgress(p0, (await subtopicsOf("aud"))[0]);
    await q("update users set trial_ends_at = now() - interval '1 day' where email = $1", [(await userRow(role)).email]);
    before = await progressSnapshot(role);
  }
  test.setTimeout(480_000); // checkout + webhook + quest generation
  // Re-runs: put an already-upgraded account back to "expired" (cancel its earlier test subscriptions).
  const prior = await userRow(role);
  if (prior.stripe_customer_id) {
    const active = await stripe("GET", `/subscriptions?customer=${prior.stripe_customer_id}&status=active`);
    for (const s of active.data) await stripe("DELETE", `/subscriptions/${s.id}`);
    if (active.data.length) {
      await expect.poll(async () => (await userRow(role)).subscription_status, { timeout: 60_000 }).not.toBe("active");
    }
  }
  await q("update users set subscription_status = 'free', plan_type = 'free' where id = $1", [prior.id]);

  // Streak scenario: a 7-day streak (10..4 days ago); the trial ended 3 days ago; the user
  // subscribes today, 3 days late. The locked days are frozen, so the next active day is day 8.
  await seedQuestStreak(role, 10, 4);
  await q("update users set trial_ends_at = now() - interval '3 days' where email = $1", [(await userRow(role)).email]);
  const u0 = await userRow(role);
  await q("delete from streak_freezes where user_id = $1", [u0.id]);
  // The quest pre-generated for the day the trial ended was never done (user was locked out).
  await q("insert into daily_quests (user_id, quest_date, status) values ($1, $2::date, 'pending')", [u0.id, localDaysAgo(3)]);
  before = await progressSnapshot(role);

  const page = await as(role);
  // Paywall shows the streak as saved (7), not broken.
  await open(page, "/subscribe?reason=trial_ended");
  await expect(page.getByTestId("saved-progress").getByText("7", { exact: true })).toBeVisible();

  await checkout(page, "Monthly");
  await expectFullAccess(page, role);
  const after = await progressSnapshot(role);
  expect({ ...after, trialUsage: 0 }, "XP, streaks, level, skills, history unchanged").toEqual({ ...before, trialUsage: 0 });
  await open(page, "/progress");
  await expect(page.getByText(/AUD/).first()).toBeVisible();

  // The webhook recorded the locked gap as a freeze.
  const freezes = await q<{ start_date: string; end_date: string }>(
    "select to_char(start_date, 'YYYY-MM-DD') start_date, to_char(end_date, 'YYYY-MM-DD') end_date from streak_freezes where user_id = $1",
    [u0.id]
  );
  expect(freezes).toEqual([{ start_date: localDaysAgo(3), end_date: localDaysAgo(0) }]);
  // A quest left undone while locked out is not a "missed" quest (no recommit block).
  expect((await api(page, "GET", "/api/daily-quest/accountability")).body.isBlocked).toBe(false);

  // First active day back: complete today's quest -> streak 8.
  const gen = await api(page, "POST", "/api/daily-quest/generate");
  expect(gen.status, JSON.stringify(gen.body).slice(0, 200)).toBeLessThan(300);
  const quest = await api(page, "GET", "/api/daily-quest");
  const problems = (quest.body?.problems ?? quest.body?.quest?.problems ?? []) as any[];
  expect(problems.length, "today's quest generated on the first day back").toBeGreaterThan(0);
  for (const p of problems) {
    await api(page, "POST", "/api/daily-quest/answer", { questProblemId: p.id, selectedOption: 0, responseTimeMs: 4000 });
  }
  const done = await api(page, "POST", "/api/daily-quest/complete", { questId: quest.body?.quest?.id ?? quest.body?.id, timeElapsedSeconds: 60 });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBeLessThan(300);
  expect(done.body.streak, "streak continues at 8").toBe(8);
  expect((await userRow(role) as any).current_streak).toBe(8);
  expect((await api(page, "GET", "/api/profile")).body.streak).toBe(8);
});

test("C trial -> Pro (Annual)", async ({ as }) => {
  const role = "pro-annual" as const;
  await resetToFreshTrial(role);
  const page = await as(role);
  await checkout(page, "Annual");
  await expectFullAccess(page, role);
  const u = await userRow(role);
  const subs = await stripe("GET", `/subscriptions?customer=${u.stripe_customer_id}&status=all`);
  expect(subs.data[0].items.data[0].price.recurring.interval).toBe("year");
  expect(subs.data[0].items.data[0].price.unit_amount).toBe(18000);
});

test("C pro account upgrade (Monthly) for area D", async ({ as }) => {
  const role = "pro" as const;
  const u = await userRow(role);
  test.skip(u.subscription_status === "active", "already Pro");
  await resetToFreshTrial(role);
  const page = await as(role);
  await checkout(page, "Monthly");
  await expectFullAccess(page, role);
});

test("C replaying the same webhook event has no duplicate effect", async () => {
  const u = await userRow("pro-annual");
  const events = await stripe("GET", `/events?type=checkout.session.completed&limit=20`);
  const ev = events.data.find((e: any) => e.data.object.customer === u.stripe_customer_id);
  expect(ev, "checkout.session.completed for pro-annual").toBeTruthy();
  const rowsBefore = await q("select id from stripe_events where id = $1", [ev.id]);
  expect(rowsBefore, "event processed once").toHaveLength(1);
  const snap = await userRow("pro-annual");

  for (let i = 0; i < 2; i++) {
    const r = await replayEvent(ev.id);
    expect(r.status).toBe(200);
    expect(r.body).toContain('"duplicate":true');
  }
  expect(await q("select id from stripe_events where id = $1", [ev.id])).toHaveLength(1);
  const after = await userRow("pro-annual");
  expect({ ...after, updated_at: null }).toEqual({ ...snap, updated_at: null });
});

test("C cancelling in Stripe follows the webhook cancel rule", async ({ as }) => {
  const role = "pro-annual" as const;
  const u = await userRow(role);
  const subs = await stripe("GET", `/subscriptions?customer=${u.stripe_customer_id}&status=active`);
  await stripe("DELETE", `/subscriptions/${subs.data[0].id}`);
  await expect.poll(async () => (await userRow(role)).subscription_status, { timeout: 60_000 }).toBe("canceled");
  const after = await userRow(role);
  expect(after.plan_type).toBe("free");
  // Immediate cancel = no Pro. The trial window from signup still applies (here: still inside 7 days).
  const page = await as(role);
  const tier = (await api(page, "GET", "/api/trial")).body.tier;
  expect(["trial", "expired"]).toContain(tier);
  test.info().annotations.push({ type: "note", description: `after cancel: status=canceled, tier=${tier}` });
});
