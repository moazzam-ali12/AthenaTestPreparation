import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { paymentFailedHtml } from "@/lib/email/templates";
import { getAccess, isGraceReminderDue } from "@/lib/subscription";

/**
 * Sends the "grace ends in ~2 days" email to past_due users who haven't fixed their
 * card. The first-failure email is sent by the Stripe webhook. Safe to run often:
 * each user is claimed via payment_reminder_sent_at before sending, once per spell.
 * Called from the notifications cron tick and /api/cron/payment-grace (manual).
 */
export async function sendGraceReminders(now: Date, dryRun = false) {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, display_name, subscription_status, trial_ends_at, created_at, payment_failed_at, payment_reminder_sent_at")
    .eq("subscription_status", "past_due")
    .not("payment_failed_at", "is", null)
    .is("payment_reminder_sent_at", null);
  if (error) throw new Error("Failed to load past_due users");

  const access = (u: NonNullable<typeof users>[number]) => ({
    subscriptionStatus: u.subscription_status,
    trialEndsAt: u.trial_ends_at,
    createdAt: u.created_at,
    paymentFailedAt: u.payment_failed_at,
  });
  const due = (users ?? []).filter(
    (u) => !!u.email && isGraceReminderDue({ ...access(u), paymentReminderSentAt: u.payment_reminder_sent_at }, now)
  );
  if (dryRun) return { sent: 0, userIds: due.map((u) => u.id) };

  let sent = 0;
  for (const u of due) {
    // Claim first so an overlapping run can't double-send.
    const { data: claimed } = await supabase
      .from("users")
      .update({ payment_reminder_sent_at: now.toISOString() })
      .eq("id", u.id)
      .is("payment_reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const { graceDaysLeft } = getAccess(access(u), now);
    const t = paymentFailedHtml({
      displayName: u.display_name ?? "there",
      daysLeft: Math.max(1, graceDaysLeft),
      reminder: true,
    });
    try {
      await sendEmail({ to: u.email!, subject: t.subject, html: t.html });
      sent++;
    } catch (err) {
      console.error("Grace reminder email failed:", err);
    }
  }
  return { sent, userIds: due.map((u) => u.id) };
}
