// Copy for each notification type: one email (Resend) + one push payload.
import { notificationEmailHtml, streakAlertHtml } from "@/lib/email/templates";
import type { NotificationType, QuestEvents, WeeklyStats } from "./rules";
import { formatMins } from "./time";

export type PushPayload = { title: string; body: string; url?: string };
export type Message = { subject: string; html: string; push: PushPayload };

export type MessageInput = {
  type: NotificationType;
  displayName: string | null;
  studyMins?: number;
  streak?: number;
  weekly?: WeeklyStats;
  events?: QuestEvents;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderMessage(m: MessageInput): Message {
  const name = esc(m.displayName || "there");
  const at = m.studyMins != null ? formatMins(m.studyMins) : "your study time";
  switch (m.type) {
    case "quest_available":
      return {
        ...notificationEmailHtml({
          subject: "🎯 Today's quest is ready",
          emoji: "🎯",
          heading: `It's study time, ${name}!`,
          lines: [`Your daily quest is ready. You have 24 hours to complete it.`],
          ctaLabel: "Start Today's Quest",
          ctaPath: "/quest",
        }),
        push: { title: "Today's quest is ready 🎯", body: "It's your study time — you have 24 hours to finish.", url: "/quest" },
      };
    case "incomplete_reminder":
      return {
        ...notificationEmailHtml({
          subject: "⏳ Your quest is still waiting",
          emoji: "⏳",
          heading: `Still time, ${name}`,
          lines: [`Your quest from ${at} isn't done yet. A few minutes now keeps you on track.`],
          ctaLabel: "Finish My Quest",
          ctaPath: "/quest",
        }),
        push: { title: "Your quest is still waiting ⏳", body: "A few minutes now keeps you on track.", url: "/quest" },
      };
    case "final_reminder":
      return {
        ...notificationEmailHtml({
          subject: "⚠️ 1 hour left on today's quest",
          emoji: "⚠️",
          heading: `Last call, ${name}`,
          lines: [`Your quest window closes in about an hour. Miss it and practice locks until you recommit.`],
          ctaLabel: "Complete It Now",
          ctaPath: "/quest",
          ctaColor: "#dc2626",
        }),
        push: { title: "1 hour left ⚠️", body: "Finish your quest before practice locks.", url: "/quest" },
      };
    case "missed_quest":
      return {
        ...notificationEmailHtml({
          subject: "🔒 Quest missed — practice is locked",
          emoji: "🔒",
          heading: `We missed you, ${name}`,
          lines: [
            `Your quest window closed without a completion, so practice is locked.`,
            `Recommit in the app to unlock it and get back on track.`,
          ],
          ctaLabel: "Recommit",
        }),
        push: { title: "Practice locked 🔒", body: "Your quest window closed. Recommit to unlock practice.", url: "/dashboard" },
      };
    case "streak_at_risk": {
      const streak = m.streak ?? 0;
      return {
        ...streakAlertHtml({ displayName: name, streak }),
        push: {
          title: "Your streak is at risk! 🔥",
          body: `You're on a ${streak}-day streak — complete today's quest to keep it alive.`,
          url: "/quest",
        },
      };
    }
    case "weekly_summary": {
      const w = m.weekly ?? { questsDone: 0, accuracy: null, xp: 0, scoreChange: null };
      const acc = w.accuracy == null ? "—" : `${Math.round(w.accuracy * 100)}%`;
      const change =
        w.scoreChange == null ? "not enough data yet" : `${w.scoreChange >= 0 ? "+" : ""}${w.scoreChange} pts`;
      return {
        ...notificationEmailHtml({
          subject: "📊 Your week in review",
          emoji: "📊",
          heading: `Your week, ${name}`,
          lines: [
            `Quests completed: <strong>${w.questsDone}</strong>`,
            `Accuracy: <strong>${acc}</strong> · XP earned: <strong>${w.xp}</strong>`,
            `Estimated score change: <strong>${change}</strong>`,
          ],
          ctaLabel: "See My Progress",
          ctaPath: "/progress",
        }),
        push: {
          title: "Your week in review 📊",
          body: `${w.questsDone} quests · ${acc} accuracy · ${w.xp} XP · score ${change}`,
          url: "/progress",
        },
      };
    }
    case "quest_complete": {
      const e = m.events ?? { xpEarned: 0, levelUp: null, tierPromotion: null, milestone: null };
      const extras = [
        e.levelUp != null ? `Overall level ${e.levelUp} reached!` : null,
        e.tierPromotion ? `Promoted to ${esc(e.tierPromotion)} tier!` : null,
        e.milestone != null ? `Your estimated score passed ${e.milestone}!` : null,
      ].filter((x): x is string => !!x);
      return {
        ...notificationEmailHtml({
          subject: extras.length ? `🏆 Quest complete — ${extras[0]}` : `✅ Quest complete: +${e.xpEarned} XP`,
          emoji: extras.length ? "🏆" : "✅",
          heading: `Nice work, ${name}!`,
          lines: [`You earned <strong>${e.xpEarned} XP</strong> on today's quest.`, ...extras],
          ctaLabel: "See My Progress",
          ctaPath: "/progress",
        }),
        push: { title: `Quest complete: +${e.xpEarned} XP`, body: extras.join(" ") || "See you at your next session.", url: "/progress" },
      };
    }
  }
}
