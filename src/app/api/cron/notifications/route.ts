import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { runNotificationTick } from "@/lib/notifications/scheduler";
import { liveSenders, supabaseNotificationStore } from "@/lib/notifications/store";
import { sendGraceReminders } from "@/lib/email/grace-reminders";

// Every 15 minutes, triggered by Supabase pg_cron + pg_net (see migration
// 20261120000000_notification_log.sql) with `Authorization: Bearer $CRON_SECRET`.
// Replaces the old daily-reminders and streak-alerts Vercel crons.
// `?dryRun=1&now=<ISO>` returns [{ userId, type, channel }] for that simulated instant
// without sending or writing the log (`now` is only honoured in a dry run).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  let now = new Date();
  if (dryRun && params.get("now")) {
    now = new Date(params.get("now")!);
    if (Number.isNaN(now.getTime())) return NextResponse.json({ error: "Invalid now" }, { status: 400 });
  }

  const tick = async () => {
    const result = await runNotificationTick({ store: supabaseNotificationStore, senders: liveSenders, now, dryRun });
    // Failed-payment "grace ends soon" email rides on the same tick. Non-fatal.
    let graceReminders: number | string[] = 0;
    try {
      const g = await sendGraceReminders(now, dryRun);
      graceReminders = dryRun ? g.userIds : g.sent;
    } catch (e) {
      console.error("Grace reminders failed (non-fatal):", e);
    }
    return { ...result, graceReminders };
  };

  try {
    // Real ticks report a Sentry cron check-in (monitor auto-created on first run;
    // alerts on missed / failed / >2 min runs). Dry runs are not monitored. No-op without a DSN.
    const body = dryRun
      ? await tick()
      : await Sentry.withMonitor("notifications-cron", tick, {
          schedule: { type: "crontab", value: "*/15 * * * *" },
          timezone: "UTC",
          checkinMargin: 5,
          maxRuntime: 2,
        });
    return NextResponse.json(body);
  } catch (e) {
    Sentry.captureException(e);
    console.error("Notification cron failed:", e);
    return NextResponse.json({ error: "Notification cron failed" }, { status: 500 });
  }
}
