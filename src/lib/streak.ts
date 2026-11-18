// Pure streak math (no I/O). Dates are local calendar days as "YYYY-MM-DD".
//
// Freeze periods (streak_freezes table) are days the user was locked out of the
// app — trial ended or subscription lapsed — before (re)subscribing. A frozen
// day neither extends nor breaks a streak. Missing a day while the user HAS
// access still breaks it.

export type FreezeRange = { startDate: string; endDate: string };

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" date. */
function weekday(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** True when `date` falls inside any freeze period (inclusive). */
export function isFrozen(date: string, freezes: readonly FreezeRange[]): boolean {
  return freezes.some((f) => date >= f.startDate && date <= f.endDate);
}

/**
 * Consecutive-day streak ending today (or yesterday — today isn't over yet).
 * Frozen days are skipped while walking back.
 */
export function computeDailyStreak(
  activeDates: readonly string[],
  today: string,
  freezes: readonly FreezeRange[] = []
): number {
  if (activeDates.length === 0) return 0;
  const active = new Set(activeDates);
  const earliest = activeDates.reduce((min, d) => (d < min ? d : min));

  let cursor = active.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (cursor >= earliest) {
    if (active.has(cursor)) streak++;
    else if (!isFrozen(cursor, freezes)) break;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Consecutive-week streak (Sun–Sat weeks with at least one active day), ending
 * this week or last week (one week's grace). A week with no activity is skipped
 * instead of breaking the streak when any of its days is frozen.
 */
export function computeWeeklyStreak(
  activeDates: readonly string[],
  today: string,
  freezes: readonly FreezeRange[] = []
): number {
  if (activeDates.length === 0) return 0;
  const weekStart = (d: string) => addDays(d, -weekday(d));
  const activeWeeks = new Set(activeDates.map(weekStart));
  const earliest = activeDates.reduce((min, d) => (d < min ? d : min));
  const weekFrozen = (start: string) =>
    Array.from({ length: 7 }, (_, i) => addDays(start, i)).some((d) => isFrozen(d, freezes));

  let cursor = weekStart(today);
  if (!activeWeeks.has(cursor)) cursor = addDays(cursor, -7);
  let streak = 0;
  while (cursor >= weekStart(earliest)) {
    if (activeWeeks.has(cursor)) streak++;
    else if (!weekFrozen(cursor)) break;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

/**
 * The freeze to record when a locked-out user gains Pro access: from the day
 * access ended (trial end, or the end of the previous subscription — whichever
 * is later) through the activation day, inclusive. Null when there was no gap.
 */
export function lockedGap(
  accessEndedOn: string | null,
  activatedOn: string
): FreezeRange | null {
  if (!accessEndedOn || accessEndedOn > activatedOn) return null;
  return { startDate: accessEndedOn, endDate: activatedOn };
}

// ── Stored streak (users.current_streak + users.streak_last_date) ──
// record_streak_day (SQL, migration 20261116000000) keeps the stored values; it
// uses the same continuation rule as computeDailyStreak above.

/**
 * Where streak reads come from. 'computed' rebuilds it from quest history;
 * 'stored' reads the user row (O(1)). Flip to 'stored' only after
 * scripts/streak-reconcile.ts reports a 100% match.
 */
export type StreakSource = "computed" | "stored";
export const STREAK_SOURCE: StreakSource = "computed";

/** The streak as of `streakLastDate` (what record_streak_day maintains). */
export type StoredStreak = { currentStreak: number; streakLastDate: string | null };

/**
 * Live streak from the stored row: `currentStreak` while still alive, else 0.
 * Alive = every day strictly between the last counted day and today is frozen
 * (today itself is grace) — the same rule computeDailyStreak walks.
 */
export function getEffectiveStreak(
  row: StoredStreak | null | undefined,
  freezes: readonly FreezeRange[],
  today: string
): number {
  if (!row?.streakLastDate || row.currentStreak <= 0) return 0;
  if (row.streakLastDate >= today) return row.currentStreak;
  for (let d = addDays(row.streakLastDate, 1); d < today; d = addDays(d, 1)) {
    if (!isFrozen(d, freezes)) return 0;
  }
  return row.currentStreak;
}

/** The stored values computeDailyStreak implies (backfill / reconcile). */
export function storedStreakFromHistory(
  activeDates: readonly string[],
  freezes: readonly FreezeRange[] = []
): StoredStreak {
  if (activeDates.length === 0) return { currentStreak: 0, streakLastDate: null };
  const last = activeDates.reduce((max, d) => (d > max ? d : max));
  return { currentStreak: computeDailyStreak(activeDates, last, freezes), streakLastDate: last };
}

/** The streak from already-loaded inputs, by source (batch jobs such as the alert cron). */
export function streakFromSource(
  source: StreakSource,
  input: {
    today: string;
    freezes: readonly FreezeRange[];
    dates?: readonly string[];
    stored?: StoredStreak | null;
  }
): number {
  return source === "stored"
    ? getEffectiveStreak(input.stored, input.freezes, input.today)
    : computeDailyStreak(input.dates ?? [], input.today, input.freezes);
}

/**
 * THE streak read, for one user, from the configured source. Loaders are lazy:
 * 'stored' never loads quest history; 'computed' never reads the stored row.
 */
export async function readStreak(
  today: string,
  load: {
    freezes: () => Promise<readonly FreezeRange[]>;
    dates: () => Promise<readonly string[]>;
    stored: () => Promise<StoredStreak | null>;
  },
  source: StreakSource = STREAK_SOURCE
): Promise<number> {
  if (source === "stored") {
    const [stored, freezes] = await Promise.all([load.stored(), load.freezes()]);
    return streakFromSource(source, { today, freezes, stored });
  }
  const [dates, freezes] = await Promise.all([load.dates(), load.freezes()]);
  return streakFromSource(source, { today, freezes, dates });
}
