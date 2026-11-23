// Streak fixtures shared by the TS tests (stored-streak.test.ts) and the SQL test
// (supabase/tests/stored-streak.sql.test.ts), so record_streak_day is checked
// against computeDailyStreak on the same data.
import { addDays, lockedGap, type FreezeRange } from "./streak";

const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

export const FIXTURES: { name: string; dates: string[]; freezes: FreezeRange[] }[] = [
  { name: "empty", dates: [], freezes: [] },
  { name: "7 days", dates: run("2026-11-01", 7), freezes: [] },
  { name: "missed day", dates: [...run("2026-11-01", 3), ...run("2026-11-05", 2)], freezes: [] },
  { name: "frozen gap 7 -> 8", dates: [...run("2026-11-01", 7), "2026-11-11"], freezes: [lockedGap("2026-11-08", "2026-11-10")!] },
  { name: "gap partly frozen", dates: [...run("2026-11-01", 7), "2026-11-12"], freezes: [lockedGap("2026-11-08", "2026-11-10")!] },
  {
    name: "two freezes",
    dates: [...run("2026-11-01", 3), ...run("2026-11-06", 2), "2026-11-12"],
    freezes: [lockedGap("2026-11-04", "2026-11-05")!, lockedGap("2026-11-08", "2026-11-11")!],
  },
];

