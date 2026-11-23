// Pure notification rules: given one user's context and the current instant, which
// notifications are due right now. No I/O — the scheduler loads data and sends.
import { scaleScore } from "@/lib/cpa-scoring";
import {
  DAY,
  HOUR,
  MINUTE,
  addDays,
  dayOfWeek,
  localParts,
  timeToMins,
  zonedToUtc,
} from "./time";

export const NOTIFICATION_TYPES = [
  "quest_available",
  "incomplete_reminder",
  "final_reminder",
  "missed_quest",
  "streak_at_risk",
  "weekly_summary",
  "quest_complete",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CHANNELS = ["email", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

/** users.notification_settings: `{ [type]: { email?: false, push?: false } }`; missing = on. */
export type NotificationSettings = Partial<Record<NotificationType, Partial<Record<Channel, boolean>>>>;

/** A rule fires when the cron tick lands in [trigger, trigger + CATCH_UP). The cron runs
 * every 15 min; 30 min of slack covers one missed/late tick (the log stops doubles). */
export const CATCH_UP_MS = 30 * MINUTE;
export const INCOMPLETE_AFTER_MS = 4 * HOUR;
export const FINAL_BEFORE_CLOSE_MS = 1 * HOUR;
export const QUEST_WINDOW_MS = 1 * DAY;
export const STREAK_ALERT_MINS = 20 * 60; // 8 PM local
export const QUIET_START_MINS = 22 * 60;
export const QUIET_END_MINS = 7 * 60;

export type ScheduleSlot = { dayOfWeek: string; startTime: string };
export type QuestRecord = {
  questDate: string;
  /** Completion instant (daily_quests.updated_at of a completed quest). */
  completedAt: string;
  correctCount: number;
  totalQuestions: number;
  xpEarned: number;
};

export type UserContext = {
  userId: string;
  timezone: string;
  email: string | null;
  hasPush: boolean;
  expired: boolean;
  settings: NotificationSettings;
  slots: readonly ScheduleSlot[];
  /** Completed quests, at least the last 15 days. */
  quests: readonly QuestRecord[];
};

export type WeeklyStats = {
  questsDone: number;
  accuracy: number | null; // 0–1
  xp: number;
  /** Change in estimated (scaled 0–99) score vs the previous 7 days; null without data. */
  scoreChange: number | null;
};

export type DueNotification = {
  userId: string;
  type: NotificationType;
  /** Dedupe key day: the study day the window opened (local), or today for daily rules. */
  localDate: string;
  channels: Channel[];
  /** Local study time (minutes) — for message copy. */
  studyMins?: number;
  weekly?: WeeklyStats;
};

// ---------------------------------------------------------------------------
// Building blocks

/** Earliest active study time on a weekday, or null if it isn't a study day. */
export function studyMinutes(slots: readonly ScheduleSlot[], dow: string): number | null {
  const mins = slots.filter((s) => s.dayOfWeek === dow).map((s) => timeToMins(s.startTime));
  return mins.length ? Math.min(...mins) : null;
}

export type StudyWindow = {
  /** Local study day the window opened on. */
  date: string;
  studyMins: number;
  start: Date;
  end: Date;
  /** A quest was completed between local midnight of `date` and the window close. */
  done: boolean;
};

/** Study windows that may still have a pending trigger at `now` (opened in the last 2 days). */
export function studyWindows(ctx: UserContext, now: Date): StudyWindow[] {
  const today = localParts(now, ctx.timezone).date;
  const out: StudyWindow[] = [];
  for (const k of [-2, -1, 0]) {
    const date = addDays(today, k);
    const studyMins = studyMinutes(ctx.slots, dayOfWeek(date));
    if (studyMins == null) continue;
    const start = zonedToUtc(date, studyMins, ctx.timezone);
    const end = new Date(start.getTime() + QUEST_WINDOW_MS);
    const from = zonedToUtc(date, 0, ctx.timezone).getTime();
    const done = ctx.quests.some((q) => {
      const t = Date.parse(q.completedAt);
      return t >= from && t < end.getTime();
    });
    out.push({ date, studyMins, start, end, done });
  }
  return out;
}

export function isQuiet(at: Date, tz: string): boolean {
  const { mins } = localParts(at, tz);
  return mins >= QUIET_START_MINS || mins < QUIET_END_MINS;
}

/** Types that are moved to 07:00 instead of dropped when they land in quiet hours. */
const DEFERRABLE: ReadonlySet<NotificationType> = new Set(["missed_quest", "weekly_summary"]);

/**
 * Quiet hours (22:00–07:00 local): the final reminder is exempt; missed-quest and weekly
 * summary are deferred to 07:00; other nudges are dropped (they'd be stale by morning).
 * Returns the effective trigger, or null if the notification is dropped.
 */
export function applyQuietHours(type: NotificationType, trigger: Date, tz: string): Date | null {
  if (type === "final_reminder" || !isQuiet(trigger, tz)) return trigger;
  if (!DEFERRABLE.has(type)) return null;
  const { date, mins } = localParts(trigger, tz);
  const morningDate = mins >= QUIET_START_MINS ? addDays(date, 1) : date;
  return zonedToUtc(morningDate, QUIET_END_MINS, tz);
}

/** Fires when `now` ∈ [trigger, trigger + CATCH_UP) after quiet-hours policy, and `now`
 * itself isn't quiet (except the final reminder). */
export function isDue(type: NotificationType, trigger: Date, now: Date, tz: string): boolean {
  const t = applyQuietHours(type, trigger, tz);
  if (!t) return false;
  const delta = now.getTime() - t.getTime();
  if (delta < 0 || delta >= CATCH_UP_MS) return false;
  return type === "final_reminder" || !isQuiet(now, tz);
}

export function channelsFor(ctx: Pick<UserContext, "email" | "hasPush" | "settings">, type: NotificationType): Channel[] {
  const pref = ctx.settings?.[type] ?? {};
  const out: Channel[] = [];
  if (ctx.email && pref.email !== false) out.push("email");
  if (ctx.hasPush && pref.push !== false) out.push("push");
  return out;
}

// ---------------------------------------------------------------------------
// Rules — each returns the trigger instant if its condition holds, else null.

type Due = { type: NotificationType; localDate: string; trigger: Date; studyMins?: number };

export function questAvailableRule(w: StudyWindow): Due | null {
  return w.done ? null : { type: "quest_available", localDate: w.date, trigger: w.start, studyMins: w.studyMins };
}

export function incompleteReminderRule(w: StudyWindow): Due | null {
  if (w.done) return null;
  return {
    type: "incomplete_reminder",
    localDate: w.date,
    trigger: new Date(w.start.getTime() + INCOMPLETE_AFTER_MS),
    studyMins: w.studyMins,
  };
}

export function finalReminderRule(w: StudyWindow): Due | null {
  if (w.done) return null;
  return {
    type: "final_reminder",
    localDate: w.date,
    trigger: new Date(w.end.getTime() - FINAL_BEFORE_CLOSE_MS),
    studyMins: w.studyMins,
  };
}

export function missedQuestRule(w: StudyWindow): Due | null {
  return w.done ? null : { type: "missed_quest", localDate: w.date, trigger: w.end, studyMins: w.studyMins };
}

const WINDOW_RULES = [questAvailableRule, incompleteReminderRule, finalReminderRule, missedQuestRule];

/** Local dates on which the user completed a quest. */
export function completedLocalDates(ctx: UserContext): Set<string> {
  return new Set(ctx.quests.map((q) => localParts(new Date(q.completedAt), ctx.timezone).date));
}

/** 8 PM local, if the user completed a quest yesterday (local) but not yet today. The
 * streak number itself comes from streak-alerts.ts (planStreakAlerts). */
export function streakAtRiskRule(ctx: UserContext, now: Date): Due | null {
  const today = localParts(now, ctx.timezone).date;
  const done = completedLocalDates(ctx);
  if (done.has(today) || !done.has(addDays(today, -1))) return null;
  return { type: "streak_at_risk", localDate: today, trigger: zonedToUtc(today, STREAK_ALERT_MINS, ctx.timezone) };
}

/** Sunday at the user's study time (Sunday's slot, else their earliest slot). Monday is
 * also checked so a summary deferred out of Sunday-night quiet hours still fires. */
export function weeklySummaryRule(ctx: UserContext, now: Date): Due | null {
  const { date, dow } = localParts(now, ctx.timezone);
  if (!ctx.slots.length) return null;
  const sunday = dow === "sunday" ? date : dow === "monday" ? addDays(date, -1) : null;
  if (!sunday) return null;
  const studyMins = studyMinutes(ctx.slots, "sunday") ?? Math.min(...ctx.slots.map((s) => timeToMins(s.startTime)));
  return { type: "weekly_summary", localDate: sunday, trigger: zonedToUtc(sunday, studyMins, ctx.timezone), studyMins };
}

/** Last 7 local days up to `asOf` vs the 7 before. Estimated score = scaled accuracy. */
export function weeklyStats(ctx: UserContext, asOf: Date): WeeklyStats {
  const now = asOf;
  const today = localParts(now, ctx.timezone).date;
  const weekStart = zonedToUtc(addDays(today, -6), 0, ctx.timezone).getTime();
  const prevStart = zonedToUtc(addDays(today, -13), 0, ctx.timezone).getTime();
  const sum = (from: number, to: number) => {
    const qs = ctx.quests.filter((q) => {
      const t = Date.parse(q.completedAt);
      return t >= from && t < to;
    });
    return {
      n: qs.length,
      correct: qs.reduce((a, q) => a + q.correctCount, 0),
      total: qs.reduce((a, q) => a + q.totalQuestions, 0),
      xp: qs.reduce((a, q) => a + q.xpEarned, 0),
    };
  };
  const cur = sum(weekStart, now.getTime() + 1);
  const prev = sum(prevStart, weekStart);
  return {
    questsDone: cur.n,
    accuracy: cur.total ? cur.correct / cur.total : null,
    xp: cur.xp,
    scoreChange:
      cur.total && prev.total ? scaleScore(cur.correct, cur.total) - scaleScore(prev.correct, prev.total) : null,
  };
}

/** Everything due for this user at `now` (before dedupe against the log). */
export function planUser(ctx: UserContext, now: Date): DueNotification[] {
  if (ctx.expired) return [];
  const candidates: Due[] = [];
  for (const w of studyWindows(ctx, now)) {
    for (const rule of WINDOW_RULES) {
      const d = rule(w);
      if (d) candidates.push(d);
    }
  }
  const streak = streakAtRiskRule(ctx, now);
  if (streak) candidates.push(streak);
  const weekly = weeklySummaryRule(ctx, now);
  if (weekly) candidates.push(weekly);

  const out: DueNotification[] = [];
  for (const d of candidates) {
    if (!isDue(d.type, d.trigger, now, ctx.timezone)) continue;
    const channels = channelsFor(ctx, d.type);
    if (!channels.length) continue;
    out.push({
      userId: ctx.userId,
      type: d.type,
      localDate: d.localDate,
      channels,
      ...(d.studyMins != null ? { studyMins: d.studyMins } : {}),
      ...(d.type === "weekly_summary" ? { weekly: weeklyStats(ctx, d.trigger) } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event rule: one combined message per completed quest.

export const SCORE_MILESTONES = [50, 60, 70, 75, 85] as const;

export type QuestEventInput = {
  xpEarned: number;
  /** Rank (tier) change from checkNewUnlocks. */
  rankUp: { from: string; to: string } | null;
  /** overall_level recorded with the previous quest_complete log row; null = no baseline. */
  levelBaseline: number | null;
  levelNow: number;
  /** Estimated score (scaled 0–99, last 7 days) before and after this quest. */
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** Highest milestone already announced. */
  milestoneAnnounced: number | null;
};

export type QuestEvents = {
  xpEarned: number;
  levelUp: number | null;
  tierPromotion: string | null;
  milestone: number | null;
};

export function planQuestEvents(i: QuestEventInput): QuestEvents {
  const crossed = SCORE_MILESTONES.filter(
    (m) =>
      i.scoreAfter != null &&
      i.scoreAfter >= m &&
      (i.scoreBefore == null || i.scoreBefore < m) &&
      (i.milestoneAnnounced == null || m > i.milestoneAnnounced)
  );
  return {
    xpEarned: i.xpEarned,
    levelUp: i.levelBaseline != null && i.levelNow > i.levelBaseline ? i.levelNow : null,
    tierPromotion: i.rankUp ? i.rankUp.to : null,
    milestone: crossed.length ? crossed[crossed.length - 1] : null,
  };
}
