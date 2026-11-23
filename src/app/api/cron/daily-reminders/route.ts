import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { dailyReminderHtml } from "@/lib/email/templates";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

// Runs hourly (vercel.json: "0 * * * *")
// Finds active schedule slots starting in the next 60 mins and sends one reminder
// per user. If a user has multiple slots in the window, the earliest is used.
// Schedule times are stored in the user's local time, so each user's day-of-week
// and window are evaluated in their own timezone (users.timezone, default UTC).
const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Current { dow, mins-since-midnight } in the given IANA timezone. */
function localNow(now: Date, timezone: string): { dow: string; mins: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return { dow: weekday.toLowerCase(), mins: hour * 60 + minute };
  } catch {
    // Invalid timezone → fall back to UTC.
    return { dow: DOW[now.getUTCDay()], mins: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Fetch all active slots joined with each user's timezone; filter per-user below
  // using that user's local clock rather than a single UTC comparison.
  const { data: schedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, user_id, start_time, day_of_week, users!inner(id, email, display_name, timezone)")
    .eq("is_active", true);

  if (schedErr || !schedules?.length) {
    return NextResponse.json({ sent: 0 });
  }

  type ScheduleRow = {
    id: string;
    user_id: string;
    start_time: string;
    day_of_week: string;
    users: { id: string; email: string | null; display_name: string | null; timezone: string | null };
  };

  // Filter to slots in the next 60-min window, evaluated in each user's timezone
  const inWindow = (schedules as unknown as ScheduleRow[]).filter((s) => {
    const { dow, mins: currentMins } = localNow(now, s.users?.timezone ?? "UTC");
    if (s.day_of_week !== dow) return false;
    const [h, m] = s.start_time.split(":").map(Number);
    const slotMins = h * 60 + m;
    return slotMins >= currentMins && slotMins < currentMins + 60;
  });

  if (!inWindow.length) return NextResponse.json({ sent: 0 });

  // Deduplicate: one email per user, using earliest slot in window
  const earliestByUser = new Map<string, ScheduleRow>();
  for (const slot of inWindow) {
    const existing = earliestByUser.get(slot.user_id);
    if (!existing) {
      earliestByUser.set(slot.user_id, slot);
    } else {
      const [eh, em] = existing.start_time.split(":").map(Number);
      const [sh, sm] = slot.start_time.split(":").map(Number);
      if (sh * 60 + sm < eh * 60 + em) earliestByUser.set(slot.user_id, slot);
    }
  }

  let sent = 0;
  for (const [userId, slot] of earliestByUser) {
    const user = slot.users;
    if (!user?.email) continue;

    const [h, m] = slot.start_time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const startTimeLabel = `${hour}:${String(m).padStart(2, "0")} ${period}`;

    const template = dailyReminderHtml({
      displayName: user.display_name ?? "there",
      startTime: startTimeLabel,
    });

    await Promise.allSettled([
      sendEmail({ to: user.email, subject: template.subject, html: template.html }),
      sendPushToUser(userId, {
        title: "Study time! ⏰",
        body: `Your session starts at ${startTimeLabel}. Open Athena to begin.`,
        url: "/dashboard",
      }),
    ]);
    sent++;
  }

  return NextResponse.json({ sent });
}
