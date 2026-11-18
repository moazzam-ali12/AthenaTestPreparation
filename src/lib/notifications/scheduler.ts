// One scheduler tick: page users, plan due notifications with the pure rules, dedupe
// through notification_log (claim-before-send), then deliver. All I/O is injected so the
// tick runs the same against Supabase (route) and in-memory fakes (tests).
import { getAccess, type AccessInput } from "@/lib/subscription";
import { planStreakAlerts } from "@/lib/streak-alerts";
import type { FreezeRange } from "@/lib/streak";
import { renderMessage, type PushPayload } from "./messages";
import { planUser, type Channel, type DueNotification, type NotificationSettings, type NotificationType, type QuestRecord, type ScheduleSlot } from "./rules";
import { localParts, safeTimeZone } from "./time";

export const PAGE_SIZE = 500;
/** Completed quests loaded per page: enough for windows (2 days) and weekly (14 days). */
export const QUEST_LOOKBACK_DAYS = 15;

export type UserRow = AccessInput & {
  id: string;
  email: string | null;
  displayName: string | null;
  timezone: string | null;
  settings: NotificationSettings | null;
};

export type PushSub = { endpoint: string; p256dh: string; auth: string };

export type LogRow = {
  userId: string;
  type: NotificationType;
  localDate: string;
  channel: string;
  meta?: Record<string, unknown> | null;
};

export const logKey = (r: { userId: string; type: string; localDate: string }) => `${r.userId}|${r.type}|${r.localDate}`;

export interface NotificationStore {
  /** Users ordered by id, [from, from + size). */
  loadUsers(from: number, size: number): Promise<UserRow[]>;
  loadSchedules(userIds: string[]): Promise<Map<string, ScheduleSlot[]>>;
  loadQuests(userIds: string[], sinceIso: string): Promise<Map<string, QuestRecord[]>>;
  loadPushSubs(userIds: string[]): Promise<Map<string, PushSub[]>>;
  /** Full completed quest_date history + freezes (streak number), for at-risk users only. */
  loadStreakInputs(userIds: string[]): Promise<{
    datesByUser: Map<string, string[]>;
    freezesByUser: Map<string, FreezeRange[]>;
  }>;
  /** Keys (logKey) already in notification_log — read-only, used by dry runs. */
  findLogged(rows: LogRow[]): Promise<Set<string>>;
  /** INSERT … ON CONFLICT DO NOTHING; returns the keys this call actually inserted. */
  claim(rows: LogRow[]): Promise<Set<string>>;
}

export interface Senders {
  email(to: string, subject: string, html: string): Promise<unknown>;
  push(userId: string, subs: PushSub[], payload: PushPayload): Promise<unknown>;
}

export type PlanEntry = { userId: string; type: NotificationType; channel: Channel };

export type TickResult = {
  dryRun: boolean;
  now: string;
  usersScanned: number;
  /** Notifications delivered (or, in a dry run, that would be). */
  sent: number;
  /** Due but already in the log (another run sent them). */
  deduped: number;
  plan?: PlanEntry[];
};

export async function runNotificationTick(opts: {
  store: NotificationStore;
  senders: Senders;
  now: Date;
  dryRun: boolean;
  pageSize?: number;
}): Promise<TickResult> {
  const { store, senders, now, dryRun } = opts;
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const since = new Date(now.getTime() - QUEST_LOOKBACK_DAYS * 86_400_000).toISOString();
  const result: TickResult = { dryRun, now: now.toISOString(), usersScanned: 0, sent: 0, deduped: 0, ...(dryRun ? { plan: [] } : {}) };

  for (let from = 0; ; from += pageSize) {
    const users = await store.loadUsers(from, pageSize);
    if (!users.length) break;
    result.usersScanned += users.length;
    const ids = users.map((u) => u.id);

    // One query per data type for the whole page (no N+1).
    const [slotsByUser, questsByUser, pushByUser] = await Promise.all([
      store.loadSchedules(ids),
      store.loadQuests(ids, since),
      store.loadPushSubs(ids),
    ]);

    const byId = new Map(users.map((u) => [u.id, u]));
    let due: DueNotification[] = [];
    for (const u of users) {
      due.push(
        ...planUser(
          {
            userId: u.id,
            timezone: safeTimeZone(u.timezone),
            email: u.email,
            hasPush: (pushByUser.get(u.id)?.length ?? 0) > 0,
            expired: getAccess(u, now).tier === "expired",
            settings: u.settings ?? {},
            slots: slotsByUser.get(u.id) ?? [],
            quests: questsByUser.get(u.id) ?? [],
          },
          now
        )
      );
    }

    // Streak number for at-risk users: same freeze-aware helper as the app.
    const streakByUser = new Map<string, number>();
    const atRisk = due.filter((d) => d.type === "streak_at_risk").map((d) => d.userId);
    if (atRisk.length) {
      const { datesByUser, freezesByUser } = await store.loadStreakInputs(atRisk);
      for (const id of atRisk) {
        const u = byId.get(id)!;
        const today = localParts(now, safeTimeZone(u.timezone)).date;
        const [p] = planStreakAlerts(
          [{ id, email: u.email, displayName: u.displayName, subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt, createdAt: u.createdAt }],
          datesByUser,
          freezesByUser,
          today,
          now
        );
        if (p && p.streak > 0) streakByUser.set(id, p.streak);
      }
      due = due.filter((d) => d.type !== "streak_at_risk" || streakByUser.has(d.userId));
    }
    if (!due.length) continue;

    const rows: LogRow[] = due.map((d) => ({ userId: d.userId, type: d.type, localDate: d.localDate, channel: d.channels.join(",") }));

    if (dryRun) {
      const logged = await store.findLogged(rows);
      for (const d of due) {
        if (logged.has(logKey(d))) {
          result.deduped++;
          continue;
        }
        result.sent++;
        for (const channel of d.channels) result.plan!.push({ userId: d.userId, type: d.type, channel });
      }
      continue;
    }

    // Claim first: a concurrent or repeated run gets nothing back for these keys.
    const claimed = await store.claim(rows);
    for (const d of due) {
      if (!claimed.has(logKey(d))) {
        result.deduped++;
        continue;
      }
      const u = byId.get(d.userId)!;
      const msg = renderMessage({
        type: d.type,
        displayName: u.displayName,
        studyMins: d.studyMins,
        weekly: d.weekly,
        streak: streakByUser.get(d.userId),
      });
      await Promise.allSettled([
        d.channels.includes("email") && u.email ? senders.email(u.email, msg.subject, msg.html) : null,
        d.channels.includes("push") ? senders.push(u.id, pushByUser.get(u.id) ?? [], msg.push) : null,
      ]);
      result.sent++;
    }
  }
  return result;
}
