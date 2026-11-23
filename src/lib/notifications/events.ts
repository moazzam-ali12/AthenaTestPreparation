// Event notification: ONE combined message per completed quest (XP + level up + tier
// promotion + score milestone), deduped through notification_log like the cron rules.
import { scaleScore } from "@/lib/cpa-scoring";
import { getAccess, type AccessInput } from "@/lib/subscription";
import { renderMessage } from "./messages";
import { channelsFor, isQuiet, planQuestEvents, type NotificationSettings, type QuestEvents } from "./rules";
import { logKey, type LogRow, type PushSub, type Senders } from "./scheduler";
import { localParts, safeTimeZone } from "./time";

export type QuestCompleteContext = {
  settings: NotificationSettings;
  overallLevel: number;
  /** meta of the user's previous quest_complete log row (baseline), if any. */
  lastMeta: { overallLevel?: number; milestone?: number | null } | null;
  /** Completed quests in the last 7 days, including the one just completed. */
  recentQuests: { id: string; correctCount: number; totalQuestions: number }[];
  pushSubs: PushSub[];
};

export type QuestCompleteDeps = {
  loadContext(userId: string, sinceIso: string): Promise<QuestCompleteContext>;
  claim(rows: LogRow[]): Promise<Set<string>>;
  senders: Senders;
};

export type QuestCompleteInput = {
  user: AccessInput & { id: string; email: string | null; displayName: string | null; timezone: string | null };
  questId: string;
  xpEarned: number;
  rankUp: { from: { name: string }; to: { name: string } } | null;
  now?: Date;
};

function estimate(qs: { correctCount: number; totalQuestions: number }[]): number | null {
  const total = qs.reduce((a, q) => a + q.totalQuestions, 0);
  return total ? scaleScore(qs.reduce((a, q) => a + q.correctCount, 0), total) : null;
}

export async function notifyQuestComplete(
  deps: QuestCompleteDeps,
  input: QuestCompleteInput
): Promise<{ sent: boolean; channels: string[]; events: QuestEvents | null }> {
  const now = input.now ?? new Date();
  const { user } = input;
  if (getAccess(user, now).tier === "expired") return { sent: false, channels: [], events: null };

  const tz = safeTimeZone(user.timezone);
  const ctx = await deps.loadContext(user.id, new Date(now.getTime() - 7 * 86_400_000).toISOString());

  const events = planQuestEvents({
    xpEarned: input.xpEarned,
    rankUp: input.rankUp ? { from: input.rankUp.from.name, to: input.rankUp.to.name } : null,
    levelBaseline: ctx.lastMeta?.overallLevel ?? null,
    levelNow: ctx.overallLevel,
    scoreBefore: estimate(ctx.recentQuests.filter((q) => q.id !== input.questId)),
    scoreAfter: estimate(ctx.recentQuests),
    milestoneAnnounced: ctx.lastMeta?.milestone ?? null,
  });

  // Quiet hours / opt-outs: still log the row (channel "none") so the level/milestone
  // baseline advances and the quest can't be announced later.
  const channels = isQuiet(now, tz)
    ? []
    : channelsFor({ email: user.email, hasPush: ctx.pushSubs.length > 0, settings: ctx.settings }, "quest_complete");

  const row: LogRow = {
    userId: user.id,
    type: "quest_complete",
    localDate: localParts(now, tz).date,
    channel: channels.length ? channels.join(",") : "none",
    meta: {
      questId: input.questId,
      overallLevel: ctx.overallLevel,
      milestone: events.milestone ?? ctx.lastMeta?.milestone ?? null,
    },
  };
  const claimed = await deps.claim([row]);
  if (!claimed.has(logKey(row)) || !channels.length) return { sent: false, channels: [], events };

  const msg = renderMessage({ type: "quest_complete", displayName: user.displayName, events });
  await Promise.allSettled([
    channels.includes("email") && user.email ? deps.senders.email(user.email, msg.subject, msg.html) : null,
    channels.includes("push") ? deps.senders.push(user.id, ctx.pushSubs, msg.push) : null,
  ]);
  return { sent: true, channels, events };
}
