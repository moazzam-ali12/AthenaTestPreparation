import { NextResponse } from "next/server";
import { adminRoute, AdminInputError, notFoundJson, readJson } from "@/lib/admin/auth";
import { audited } from "@/lib/admin/audit";
import { extendedTrialEnd, userActionSchema, zodMessage } from "@/lib/admin/validation";
import { clearAccountabilityLock, getUserRowForAdmin, setTrialEnd } from "@/lib/db/queries/admin";
import { getStreakFreezes, recordStreakFreeze } from "@/lib/db/queries/streak-freezes";
import { getCurrentQuestStreak } from "@/lib/db/queries/daily-quest";
import { getAccess } from "@/lib/subscription";
import { sendEmail } from "@/lib/email/send";
import { streakAlertHtml, welcomeEmailHtml } from "@/lib/email/templates";
import { sendPushToUser } from "@/lib/push";

type Ctx = { params: Promise<{ id: string }> };

/** Support actions. Body: { action: 'extend_trial' | 'clear_lock' | 'add_streak_freeze' | 'resend_notification', ... } */
export const POST = adminRoute(async (req: Request, { params }: Ctx, admin) => {
  const { id } = await params;
  const user = await getUserRowForAdmin(id);
  if (!user) return notFoundJson();

  const parsed = userActionSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AdminInputError(zodMessage(parsed.error));
  const body = parsed.data;
  const target = { targetType: "user" as const, targetId: id };

  switch (body.action) {
    case "extend_trial": {
      // Base on the effective end (falls back to created_at + TRIAL_DAYS for old rows).
      const { trialEndsAt } = getAccess({
        subscriptionStatus: user.subscription_status,
        trialEndsAt: user.trial_ends_at,
        createdAt: user.created_at,
      });
      const next = extendedTrialEnd(trialEndsAt, body.days);
      await audited(
        admin,
        {
          ...target,
          action: "user.extend_trial",
          before: { trial_ends_at: user.trial_ends_at },
          after: { trial_ends_at: next.toISOString(), days: body.days },
        },
        () => setTrialEnd(id, next, user.trial_started_at)
      );
      return NextResponse.json({ ok: true, trialEndsAt: next.toISOString() });
    }

    case "clear_lock": {
      let resolved: string[] = [];
      await audited(
        admin,
        { ...target, action: "user.clear_lock", before: { quest_blocked: user.quest_blocked }, after: { quest_blocked: false } },
        async () => {
          resolved = await clearAccountabilityLock(id);
        }
      );
      return NextResponse.json({ ok: true, resolvedQuests: resolved.length });
    }

    case "add_streak_freeze": {
      if (body.endDate < body.startDate) throw new AdminInputError("End date is before start date");
      const before = await getStreakFreezes(id);
      const freeze = { startDate: body.startDate, endDate: body.endDate };
      await audited(
        admin,
        { ...target, action: "user.add_streak_freeze", before: { freezes: before }, after: { added: freeze } },
        () => recordStreakFreeze(id, freeze)
      );
      return NextResponse.json({ ok: true });
    }

    case "resend_notification": {
      const name = user.display_name ?? "there";
      let result: { email: boolean; push: { sent: number; failed: number } } = {
        email: false,
        push: { sent: 0, failed: 0 },
      };
      await audited(
        admin,
        { ...target, action: "user.resend_notification", after: { kind: body.kind } },
        async () => {
          if (body.kind === "welcome") {
            const t = welcomeEmailHtml({ displayName: name });
            result.email = !!(await sendEmail({ to: user.email, subject: t.subject, html: t.html }));
          } else {
            const streak = await getCurrentQuestStreak(id);
            const t = streakAlertHtml({ displayName: name, streak });
            const [mail, push] = await Promise.all([
              sendEmail({ to: user.email, subject: t.subject, html: t.html }),
              sendPushToUser(id, {
                title: "Keep your streak alive 🔥",
                body: `You're on a ${streak}-day streak. Complete today's quest to keep it going.`,
                url: "/dashboard",
              }),
            ]);
            result = { email: !!mail, push };
          }
        }
      );
      return NextResponse.json({ ok: true, ...result });
    }
  }
});
