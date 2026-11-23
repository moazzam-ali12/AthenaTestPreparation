import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STREAK_SOURCE,
  addDays,
  computeDailyStreak,
  getEffectiveStreak,
  lockedGap,
  readStreak,
  storedStreakFromHistory,
  streakFromSource,
} from "./streak";
import { FIXTURES } from "./streak.fixtures";

const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

test("getEffectiveStreak equals computeDailyStreak for every fixture and day", () => {
  for (const f of FIXTURES) {
    const stored = storedStreakFromHistory(f.dates, f.freezes);
    for (const today of run("2026-10-31", 20)) {
      // The stored row only knows days up to `today` — rebuild it from that prefix.
      const seen = f.dates.filter((d) => d <= today);
      const row = storedStreakFromHistory(seen, f.freezes);
      assert.equal(
        getEffectiveStreak(row, f.freezes, today),
        computeDailyStreak(seen, today, f.freezes),
        `${f.name} @ ${today}`
      );
    }
    assert.ok(stored.currentStreak >= 0);
  }
});

test("getEffectiveStreak: alive today / yesterday, broken after a missed day, alive across a freeze", () => {
  const row = { currentStreak: 7, streakLastDate: "2026-11-07" };
  assert.equal(getEffectiveStreak(row, [], "2026-11-07"), 7);
  assert.equal(getEffectiveStreak(row, [], "2026-11-08"), 7, "today is grace");
  assert.equal(getEffectiveStreak(row, [], "2026-11-09"), 0, "missed Nov 8");
  assert.equal(getEffectiveStreak(row, [lockedGap("2026-11-08", "2026-11-10")!], "2026-11-11"), 7);
  assert.equal(getEffectiveStreak(row, [lockedGap("2026-11-08", "2026-11-09")!], "2026-11-11"), 0, "Nov 10 not frozen");
  assert.equal(getEffectiveStreak(null, [], "2026-11-07"), 0);
  assert.equal(getEffectiveStreak({ currentStreak: 3, streakLastDate: null }, [], "2026-11-07"), 0);
});

test("storedStreakFromHistory: streak as of the last active day", () => {
  assert.deepEqual(storedStreakFromHistory([]), { currentStreak: 0, streakLastDate: null });
  assert.deepEqual(storedStreakFromHistory(FIXTURES[2].dates), { currentStreak: 2, streakLastDate: "2026-11-06" });
  assert.deepEqual(storedStreakFromHistory(FIXTURES[3].dates, FIXTURES[3].freezes), { currentStreak: 8, streakLastDate: "2026-11-11" });
});

test("source switch: default 'computed'; each source uses only its own loader", async () => {
  assert.equal(STREAK_SOURCE, "computed");
  const calls: string[] = [];
  const f = FIXTURES[3];
  const load = {
    freezes: async () => (calls.push("freezes"), f.freezes),
    dates: async () => (calls.push("dates"), f.dates),
    stored: async () => (calls.push("stored"), storedStreakFromHistory(f.dates, f.freezes)),
  };
  const computed = await readStreak("2026-11-12", load, "computed");
  assert.deepEqual(calls.sort(), ["dates", "freezes"]);
  calls.length = 0;
  const stored = await readStreak("2026-11-12", load, "stored");
  assert.deepEqual(calls.sort(), ["freezes", "stored"], "stored mode never loads quest history");
  assert.equal(computed, 8);
  assert.equal(stored, computed);
  assert.equal(streakFromSource("stored", { today: "2026-11-12", freezes: f.freezes, stored: null }), 0);
});
