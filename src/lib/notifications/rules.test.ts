import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuietHours,
  planQuestEvents,
  planUser,
  weeklyStats,
  type NotificationType,
  type UserContext,
} from "./rules";
import { localParts, zonedToUtc } from "./time";

const EVERY_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Default: Wednesdays only, so a previous day's window doesn't overlap the assertions.
const ctx = (over: Partial<UserContext> = {}, time = "17:00:00", days = ["wednesday"]): UserContext => ({
  userId: "u",
  timezone: "America/New_York",
  email: "u@example.test",
  hasPush: true,
  expired: false,
  settings: {},
  slots: days.map((d) => ({ dayOfWeek: d, startTime: time })),
  quests: [],
  ...over,
});
const at = (iso: string) => new Date(iso);
const types = (c: UserContext, iso: string): NotificationType[] => planUser(c, at(iso)).map((n) => n.type).sort();

// ---- timezone / DST ---------------------------------------------------------

test("zonedToUtc: same wall time in 3 zones", () => {
  assert.equal(zonedToUtc("2026-11-18", 18 * 60 + 30, "Asia/Karachi").toISOString(), "2026-11-18T13:30:00.000Z");
  assert.equal(zonedToUtc("2026-11-18", 18 * 60 + 30, "America/New_York").toISOString(), "2026-11-18T23:30:00.000Z");
  assert.equal(zonedToUtc("2026-11-18", 18 * 60 + 30, "Europe/London").toISOString(), "2026-11-18T18:30:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", 18 * 60 + 30, "Europe/London").toISOString(), "2026-07-01T17:30:00.000Z");
});

test("zonedToUtc: DST transitions", () => {
  // NY spring forward 2026-03-08: 02:30 doesn't exist → 03:30 EDT.
  assert.equal(zonedToUtc("2026-03-08", 150, "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
  // Study time the day before vs the DST day: one hour earlier in UTC.
  assert.equal(zonedToUtc("2026-03-07", 1110, "America/New_York").toISOString(), "2026-03-07T23:30:00.000Z");
  assert.equal(zonedToUtc("2026-03-08", 1110, "America/New_York").toISOString(), "2026-03-08T22:30:00.000Z");
  // NY fall back 2026-11-01: 01:30 happens twice → first (EDT).
  assert.equal(zonedToUtc("2026-11-01", 90, "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
  // London spring forward 2026-03-29: 01:30 doesn't exist → 02:30 BST.
  assert.equal(zonedToUtc("2026-03-29", 90, "Europe/London").toISOString(), "2026-03-29T01:30:00.000Z");
  // Local date rolls over correctly.
  assert.deepEqual(localParts(at("2026-11-18T20:00:00Z"), "Asia/Karachi"), { date: "2026-11-19", dow: "thursday", mins: 60 });
});

test("quest available fires at local study time on a DST-change day", () => {
  const c = ctx({}, "18:30:00", EVERY_DAY);
  // Every day: each study time also closes the previous day's window (missed).
  assert.deepEqual(types(c, "2026-03-07T23:30:00Z"), ["missed_quest", "quest_available"]); // 18:30 EST
  // 18:30 EDT: Sunday's quest opens. Saturday's window is a real 24h, so it closes at
  // 19:30 EDT and its final reminder lands at 18:30 EDT too. (Mar 8 is a Sunday → weekly.)
  assert.deepEqual(types(c, "2026-03-08T22:30:00Z"), ["final_reminder", "quest_available", "weekly_summary"]);
  assert.deepEqual(types(c, "2026-03-08T23:30:00Z"), ["missed_quest"]);
});

// ---- window rules (NY, study 17:00 = 22:00Z in November) ---------------------

test("quest available: at study time only, study days only", () => {
  const c = ctx();
  assert.deepEqual(types(c, "2026-11-18T21:59:00Z"), []);
  assert.deepEqual(types(c, "2026-11-18T22:00:00Z"), ["quest_available"]);
  assert.deepEqual(types(c, "2026-11-18T22:29:00Z"), ["quest_available"]); // catch-up for a late tick
  assert.deepEqual(types(c, "2026-11-18T22:30:00Z"), []);
  const mondaysOnly = ctx({ slots: [{ dayOfWeek: "monday", startTime: "17:00:00" }] });
  assert.deepEqual(types(mondaysOnly, "2026-11-18T22:00:00Z"), [], "Wednesday is not a study day");
  assert.deepEqual(types(mondaysOnly, "2026-11-16T22:00:00Z"), ["quest_available"]);
});

test("incomplete (+4h), final (close−1h), missed (close) — only while not done", () => {
  const c = ctx();
  assert.deepEqual(types(c, "2026-11-19T02:00:00Z"), ["incomplete_reminder"]); // 21:00 local
  assert.deepEqual(types(c, "2026-11-19T01:45:00Z"), []);
  // Thu 16:00 local = final reminder; Thu 17:00 = window closed → missed.
  assert.deepEqual(types(c, "2026-11-19T21:00:00Z"), ["final_reminder"]);
  assert.deepEqual(types(c, "2026-11-19T22:00:00Z"), ["missed_quest"]);
  assert.deepEqual(types(c, "2026-11-19T22:30:00Z"), []);

  const done = ctx({
    quests: [{ questDate: "2026-11-18", completedAt: "2026-11-18T23:00:00Z", correctCount: 5, totalQuestions: 5, xpEarned: 50 }],
  });
  assert.deepEqual(types(done, "2026-11-19T02:00:00Z"), []);
  assert.deepEqual(types(done, "2026-11-19T21:00:00Z"), []);
  assert.deepEqual(types(done, "2026-11-19T22:00:00Z"), []);
});

test("quiet hours: nudges dropped, final exempt, missed deferred to 07:00", () => {
  const late = ctx({}, "23:00:00"); // window Wed 23:00 → Thu 23:00 local
  assert.deepEqual(types(late, "2026-11-19T04:00:00Z"), [], "23:00 local: quest_available is quiet");
  assert.deepEqual(types(late, "2026-11-20T03:00:00Z"), ["final_reminder"], "22:00 local Thu, exempt");
  assert.deepEqual(types(late, "2026-11-20T04:00:00Z"), [], "23:00 local Thu: missed is deferred");
  assert.deepEqual(types(late, "2026-11-20T12:00:00Z"), ["missed_quest"], "07:00 local Fri");
  const deferred = applyQuietHours("missed_quest", at("2026-11-20T04:00:00Z"), "America/New_York");
  assert.equal(deferred?.toISOString(), "2026-11-20T12:00:00.000Z");
});

test("settings opt-outs per type and channel; expired users get nothing", () => {
  const emailOff = ctx({ settings: { quest_available: { email: false } } });
  assert.deepEqual(planUser(emailOff, at("2026-11-18T22:00:00Z"))[0].channels, ["push"]);
  const allOff = ctx({ settings: { quest_available: { email: false, push: false } } });
  assert.deepEqual(types(allOff, "2026-11-18T22:00:00Z"), []);
  assert.deepEqual(types(ctx({ hasPush: false, email: null }), "2026-11-18T22:00:00Z"), [], "no channel");
  assert.deepEqual(types(ctx({ expired: true }), "2026-11-18T22:00:00Z"), []);
});

test("streak at risk at 20:00 local when yesterday done and today not", () => {
  const q = (completedAt: string) => ({ questDate: "x", completedAt, correctCount: 1, totalQuestions: 1, xpEarned: 5 });
  const c = ctx({ slots: [], quests: [q("2026-11-17T23:00:00Z")] }); // Tue 18:00 local
  assert.deepEqual(types(c, "2026-11-19T01:00:00Z"), ["streak_at_risk"]); // Wed 20:00 local
  assert.deepEqual(types(c, "2026-11-19T00:45:00Z"), []);
  const safe = ctx({ slots: [], quests: [q("2026-11-17T23:00:00Z"), q("2026-11-18T15:00:00Z")] });
  assert.deepEqual(types(safe, "2026-11-19T01:00:00Z"), []);
});

test("weekly summary: Sunday at study time with stats", () => {
  const q = (completedAt: string, correct: number) => ({ questDate: "x", completedAt, correctCount: correct, totalQuestions: 10, xpEarned: 30 });
  const c = ctx({ quests: [q("2026-11-20T15:00:00Z", 8), q("2026-11-21T15:00:00Z", 9), q("2026-11-12T15:00:00Z", 5)] });
  // No Sunday slot → earliest slot (17:00). Sun 2026-11-22 17:00 local = 22:00Z.
  const due = planUser(c, at("2026-11-22T22:00:00Z"));
  const weekly = due.find((d) => d.type === "weekly_summary");
  assert.ok(weekly);
  assert.equal(weekly.localDate, "2026-11-22");
  assert.deepEqual(weekly.weekly, { questsDone: 2, accuracy: 0.85, xp: 60, scoreChange: 84 - 50 });
  assert.equal(types(c, "2026-11-21T22:00:00Z").includes("weekly_summary"), false, "not on Saturday");
  assert.deepEqual(weeklyStats(ctx(), at("2026-11-22T22:00:00Z")), { questsDone: 0, accuracy: null, xp: 0, scoreChange: null });
});

// ---- quest events -------------------------------------------------------------

test("planQuestEvents: combined XP + level + tier + milestone", () => {
  const base = { xpEarned: 40, rankUp: null, levelBaseline: 1, levelNow: 1, scoreBefore: 55, scoreAfter: 58, milestoneAnnounced: 50 };
  assert.deepEqual(planQuestEvents(base), { xpEarned: 40, levelUp: null, tierPromotion: null, milestone: null });
  assert.deepEqual(
    planQuestEvents({ ...base, rankUp: { from: "Bronze", to: "Silver" }, levelNow: 2, scoreAfter: 72 }),
    { xpEarned: 40, levelUp: 2, tierPromotion: "Silver", milestone: 70 }
  );
  assert.equal(planQuestEvents({ ...base, levelBaseline: null, levelNow: 3 }).levelUp, null, "no baseline → no claim");
  assert.equal(planQuestEvents({ ...base, scoreBefore: 48, scoreAfter: 52, milestoneAnnounced: 50 }).milestone, null, "already announced");
});
