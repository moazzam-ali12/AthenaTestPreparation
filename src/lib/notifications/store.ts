// Supabase implementation of NotificationStore + real senders (Resend, web push).
import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { sendPushToSubscriptions } from "@/lib/push";
import { getStreakFreezesForUsers } from "@/lib/db/queries/streak-freezes";
import type { QuestRecord, ScheduleSlot } from "./rules";
import type { QuestCompleteDeps } from "./events";
import { logKey, type LogRow, type NotificationStore, type PushSub, type Senders, type UserRow } from "./scheduler";

// notification_log / users.notification_settings aren't in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** `.in()` lists are chunked to keep request URLs short; each chunk pages past the
 * PostgREST max-rows cap. Still a fixed number of requests per page of users. */
const ID_CHUNK = 100;
const ROW_PAGE = 1000;

async function selectIn<T>(
  ids: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (chunk: string[]) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += ROW_PAGE) {
      const { data, error } = await build(chunk).range(from, from + ROW_PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < ROW_PAGE) break;
    }
  }
  return out;
}

function groupBy<T, V>(rows: T[], key: (r: T) => string, value: (r: T) => V): Map<string, V[]> {
  const m = new Map<string, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k) ?? [];
    list.push(value(r));
    m.set(k, list);
  }
  return m;
}

export const supabaseNotificationStore: NotificationStore = {
  async loadUsers(from, size) {
    const { data, error } = await db
      .from("users")
      .select("id, email, display_name, timezone, subscription_status, trial_ends_at, created_at, payment_failed_at, notification_settings")
      .eq("onboarding_completed", true)
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, any>[]).map(
      (u): UserRow => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        timezone: u.timezone,
        subscriptionStatus: u.subscription_status,
        trialEndsAt: u.trial_ends_at,
        createdAt: u.created_at,
        paymentFailedAt: u.payment_failed_at,
        settings: u.notification_settings ?? {},
      })
    );
  },

  async loadSchedules(ids) {
    type R = { user_id: string; day_of_week: string; start_time: string };
    const rows = await selectIn<R>(ids, (c) =>
      db.from("schedules").select("user_id, day_of_week, start_time").in("user_id", c).eq("is_active", true).order("id")
    );
    return groupBy(rows, (r) => r.user_id, (r): ScheduleSlot => ({ dayOfWeek: r.day_of_week, startTime: r.start_time }));
  },

  async loadQuests(ids, sinceIso) {
    type R = { user_id: string; quest_date: string; updated_at: string; correct_count: number; total_questions: number; xp_earned: number };
    const rows = await selectIn<R>(ids, (c) =>
      db
        .from("daily_quests")
        .select("user_id, quest_date, updated_at, correct_count, total_questions, xp_earned")
        .in("user_id", c)
        .eq("status", "completed")
        .gte("updated_at", sinceIso)
        .order("id")
    );
    return groupBy(rows, (r) => r.user_id, (r): QuestRecord => ({
      questDate: r.quest_date,
      completedAt: r.updated_at,
      correctCount: r.correct_count ?? 0,
      totalQuestions: r.total_questions ?? 0,
      xpEarned: r.xp_earned ?? 0,
    }));
  },

  async loadPushSubs(ids) {
    type R = PushSub & { user_id: string };
    const rows = await selectIn<R>(ids, (c) =>
      db.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", c).order("endpoint")
    );
    return groupBy(rows, (r) => r.user_id, ({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth }));
  },

  async loadStreakInputs(ids) {
    type R = { user_id: string; quest_date: string };
    const [rows, freezesByUser] = await Promise.all([
      selectIn<R>(ids, (c) =>
        db.from("daily_quests").select("user_id, quest_date").in("user_id", c).eq("status", "completed").order("id")
      ),
      getStreakFreezesForUsers(ids),
    ]);
    return { datesByUser: groupBy(rows, (r) => r.user_id, (r) => r.quest_date), freezesByUser };
  },

  async findLogged(rows) {
    const ids = [...new Set(rows.map((r) => r.userId))];
    const dates = [...new Set(rows.map((r) => r.localDate))];
    type R = { user_id: string; type: string; local_date: string };
    const found = await selectIn<R>(ids, (c) =>
      db.from("notification_log").select("user_id, type, local_date").in("user_id", c).in("local_date", dates).order("id")
    );
    return new Set(found.map((r) => logKey({ userId: r.user_id, type: r.type, localDate: r.local_date })));
  },

  async claim(rows) {
    return claimLogRows(rows);
  },
};

/** INSERT … ON CONFLICT (user_id, type, local_date) DO NOTHING RETURNING — only rows this
 * call inserted come back, so whoever inserts a key is the only one who sends it. */
export async function claimLogRows(rows: LogRow[]): Promise<Set<string>> {
  const claimed = new Set<string>();
  for (let i = 0; i < rows.length; i += ROW_PAGE) {
    const { data, error } = await db
      .from("notification_log")
      .upsert(
        rows.slice(i, i + ROW_PAGE).map((r) => ({
          user_id: r.userId,
          type: r.type,
          local_date: r.localDate,
          channel: r.channel,
          meta: r.meta ?? null,
        })),
        { onConflict: "user_id,type,local_date", ignoreDuplicates: true }
      )
      .select("user_id, type, local_date");
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { user_id: string; type: string; local_date: string }[]) {
      claimed.add(logKey({ userId: r.user_id, type: r.type, localDate: r.local_date }));
    }
  }
  return claimed;
}

export const liveSenders: Senders = {
  email: (to, subject, html) => sendEmail({ to, subject, html }),
  push: (userId, subs, payload) => sendPushToSubscriptions(userId, subs, payload),
};

/** Live dependencies for notifyQuestComplete (one query per data type). */
export const liveQuestCompleteDeps: QuestCompleteDeps = {
  async loadContext(userId, sinceIso) {
    const [userRes, logRes, questRes, pushRes] = await Promise.all([
      db.from("users").select("notification_settings, overall_level").eq("id", userId).maybeSingle(),
      db
        .from("notification_log")
        .select("meta")
        .eq("user_id", userId)
        .eq("type", "quest_complete")
        .order("local_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("daily_quests")
        .select("id, correct_count, total_questions")
        .eq("user_id", userId)
        .eq("status", "completed")
        .gte("updated_at", sinceIso),
      db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId),
    ]);
    return {
      settings: userRes.data?.notification_settings ?? {},
      overallLevel: userRes.data?.overall_level ?? 1,
      lastMeta: logRes.data?.meta ?? null,
      recentQuests: ((questRes.data ?? []) as { id: string; correct_count: number; total_questions: number }[]).map((q) => ({
        id: q.id,
        correctCount: q.correct_count ?? 0,
        totalQuestions: q.total_questions ?? 0,
      })),
      pushSubs: (pushRes.data ?? []) as PushSub[],
    };
  },
  claim: claimLogRows,
  senders: liveSenders,
};
