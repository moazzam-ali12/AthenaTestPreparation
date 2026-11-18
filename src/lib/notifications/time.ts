// Timezone helpers for the notification scheduler (pure, Intl-based, DST-safe).
import { addDays } from "@/lib/streak";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Returns a valid IANA zone, falling back to UTC for null/invalid values. */
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    formatter(tz);
    return tz;
  } catch {
    return "UTC";
  }
}

function wallClock(at: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Day of week ("monday") of a YYYY-MM-DD calendar date. */
export function dayOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export type LocalParts = { date: string; dow: string; mins: number };

/** The user's local calendar date, weekday and minutes since local midnight at `at`. */
export function localParts(at: Date, tz: string): LocalParts {
  const w = wallClock(at, tz);
  const date = `${w.y}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
  return { date, dow: dayOfWeek(date), mins: w.h * 60 + w.mi };
}

/** UTC offset (ms) of `tz` at instant `at`. */
function offsetMs(at: number, tz: string): number {
  const w = wallClock(new Date(at), tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads `date` + `mins`.
 * DST: a wall time skipped by spring-forward resolves to the instant just after the
 * gap (02:30 → 03:30); a repeated fall-back time resolves to its first occurrence.
 */
export function zonedToUtc(date: string, mins: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, mins);
  const c1 = wall - offsetMs(wall, tz);
  const c2 = wall - offsetMs(c1, tz);
  const matches = [c1, c2].filter((t) => {
    const p = localParts(new Date(t), tz);
    return p.date === date && p.mins === mins;
  });
  if (matches.length) return new Date(Math.min(...matches));
  // Gap: the wall time doesn't exist; keep the same UTC-relative position (shift forward).
  return new Date(Math.max(c1, c2));
}

export { addDays };

/** "HH:MM[:SS]" → minutes since midnight. */
export function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 1110 → "6:30 PM". */
export function formatMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
