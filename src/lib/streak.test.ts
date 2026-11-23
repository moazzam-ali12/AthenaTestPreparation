import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, computeDailyStreak, computeWeeklyStreak, lockedGap } from "./streak";

// Trial: Nov 1–7 active, trial ends Nov 8.
const trialDays = Array.from({ length: 7 }, (_, i) => addDays("2026-11-01", i));

test("no freezes: same rules as before (today-or-yesterday, consecutive days)", () => {
  assert.equal(computeDailyStreak([], "2026-11-07"), 0);
  assert.equal(computeDailyStreak(trialDays, "2026-11-07"), 7);
  assert.equal(computeDailyStreak(trialDays, "2026-11-08"), 7, "today not done yet keeps the streak");
  assert.equal(computeDailyStreak(trialDays, "2026-11-09"), 0, "a missed day breaks it");
  assert.equal(computeDailyStreak(["2026-11-01", "2026-11-03", "2026-11-04"], "2026-11-04"), 2);
});

test("subscribe the day after the trial ends: next active day is day 8", () => {
  const gap = lockedGap("2026-11-08", "2026-11-08")!;
  assert.equal(computeDailyStreak([...trialDays, "2026-11-08"], "2026-11-08", [gap]), 8);
});

test("subscribe 3 days later: still day 8, not day 1", () => {
  const gap = lockedGap("2026-11-08", "2026-11-10")!;
  assert.deepEqual(gap, { startDate: "2026-11-08", endDate: "2026-11-10" });
  assert.equal(computeDailyStreak([...trialDays, "2026-11-10"], "2026-11-10", [gap]), 8);
  // Before the first active day back, the streak shows as saved (7), not 0.
  assert.equal(computeDailyStreak(trialDays, "2026-11-10", [gap]), 7);
  // The activation day is frozen too: a first quest the day after subscribing still continues.
  assert.equal(computeDailyStreak([...trialDays, "2026-11-11"], "2026-11-11", [gap]), 8);
});

test("missing a day while having access still breaks the streak", () => {
  const gap = lockedGap("2026-11-08", "2026-11-10")!;
  // Subscribed Nov 10 but skipped Nov 11 → Nov 12 starts over.
  assert.equal(computeDailyStreak([...trialDays, "2026-11-12"], "2026-11-12", [gap]), 1);
  // A day missed during the trial is not rescued by a later freeze.
  const withHole = trialDays.filter((d) => d !== "2026-11-06");
  assert.equal(computeDailyStreak([...withHole, "2026-11-10"], "2026-11-10", [gap]), 2);
});

test("cancel → locked → re-subscribe: the second gap freezes too", () => {
  const gaps = [lockedGap("2026-11-08", "2026-11-09")!, lockedGap("2026-11-15", "2026-11-20")!];
  const active = [...trialDays, ...Array.from({ length: 6 }, (_, i) => addDays("2026-11-09", i)), "2026-11-20"];
  // 7 (trial) + Nov 9–14 (6) + Nov 20 = 14
  assert.equal(computeDailyStreak(active, "2026-11-20", gaps), 14);
});

test("lockedGap: none when access ends in the future or never", () => {
  assert.equal(lockedGap(null, "2026-11-08"), null);
  assert.equal(lockedGap("2026-11-09", "2026-11-08"), null);
});

test("weekly streak skips a locked week, rules otherwise unchanged", () => {
  // Active weeks of Nov 1 and Nov 22; locked Nov 8–22.
  const active = ["2026-11-02", "2026-11-23"];
  assert.equal(computeWeeklyStreak(active, "2026-11-23"), 1);
  assert.equal(computeWeeklyStreak(active, "2026-11-23", [lockedGap("2026-11-08", "2026-11-22")!]), 2);
  assert.equal(computeWeeklyStreak(["2026-11-02", "2026-11-09"], "2026-11-16"), 2, "last-week grace");
  assert.equal(computeWeeklyStreak(["2026-11-02"], "2026-11-16"), 0);
});
