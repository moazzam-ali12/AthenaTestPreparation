import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, computeDailyStreak, lockedGap } from "./streak";
import { deliverStreakAlerts, planStreakAlerts, type AlertCandidate } from "./streak-alerts";

const today = "2026-11-20";
const now = new Date("2026-11-20T20:00:00Z");
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const user = (id: string, over: Partial<AlertCandidate> = {}): AlertCandidate => ({
  id,
  email: `${id}@example.test`,
  displayName: id,
  subscriptionStatus: "active",
  trialEndsAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

test("7-day streak + 3-day frozen gap + quest yesterday: email streak = app streak", () => {
  // Active Nov 9–15, locked Nov 16–18 (frozen), subscribed, quest Nov 19.
  const dates = [...days("2026-11-09", 7), "2026-11-19"];
  const freezes = [lockedGap("2026-11-16", "2026-11-18")!];
  const [p] = planStreakAlerts([user("a")], new Map([["a", dates]]), new Map([["a", freezes]]), today, now);
  assert.equal(p.streak, computeDailyStreak(dates, today, freezes), "same helper as the app");
  assert.equal(p.streak, 8);
  assert.equal(p.wouldEmail, true);
});

test("expired user who quested before the trial ended: no email", () => {
  const expired = user("e", { subscriptionStatus: "free", trialEndsAt: "2026-11-20T08:00:00Z" });
  const [p] = planStreakAlerts([expired], new Map([["e", days("2026-11-13", 7)]]), new Map(), today, now);
  assert.equal(p.wouldEmail, false);
  assert.equal(p.skipReason, "expired");
});

test("trial/Pro with no freezes: same consecutive-days-back-from-yesterday count as before", () => {
  const trial = user("t", { subscriptionStatus: "free", trialEndsAt: "2026-11-25T00:00:00Z" });
  const pro = user("p");
  const history = new Map([
    ["t", days("2026-11-15", 5)], // Nov 15–19 → 5
    ["p", ["2026-11-10", "2026-11-11", "2026-11-17", "2026-11-18", "2026-11-19"]], // gap on Nov 16 → 3
  ]);
  const plan = planStreakAlerts([trial, pro], history, new Map(), today, now);
  assert.deepEqual(
    plan.map((p) => [p.userId, p.streak, p.wouldEmail]),
    [["t", 5, true], ["p", 3, true]]
  );
});

test("no email address: planned but not sent", () => {
  const [p] = planStreakAlerts([user("n", { email: null })], new Map([["n", ["2026-11-19"]]]), new Map(), today, now);
  assert.deepEqual([p.wouldEmail, p.skipReason], [false, "no_email"]);
});

test("deliver: only wouldEmail users, with the planned streak (mock sender, nothing real sent)", async () => {
  const cands = [user("a"), user("e", { subscriptionStatus: "free", trialEndsAt: "2026-11-01T00:00:00Z" })];
  const plan = planStreakAlerts(cands, new Map([["a", ["2026-11-19"]], ["e", ["2026-11-19"]]]), new Map(), today, now);
  const sent: [string, number][] = [];
  const n = await deliverStreakAlerts(plan, cands, async (u, streak) => {
    sent.push([u.email, streak]);
  });
  assert.equal(n, 1);
  assert.deepEqual(sent, [["a@example.test", 1]]);
});
