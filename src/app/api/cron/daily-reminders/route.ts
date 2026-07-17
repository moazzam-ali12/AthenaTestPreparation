import { supabase } from "@/lib/supabase/client";
import { sendEmail } from "@/lib/email/send";
import { dailyReminderHtml } from "@/lib/email/templates";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

// Runs hourly (vercel.json: "0 * * * *")
// Finds active schedule slots starting in the next 60 mins (UTC) and sends one reminder
// per user. If a user has multiple slots in the window, the earliest is used.
// Note: schedule times are stored in the user's local time; this is UTC-relative for MVP.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayDow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    now.getDay()
  ];
  const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const windowEnd = currentMins + 60;

  const { data: schedules, error: schedErr } = await supabase
    .from("schedules")
    .select("id, user_id, start_time")
    .eq("day_of_week", todayDow)
    .eq("is_active", true);

  if (schedErr || !schedules?.length) {
    return NextResponse.json({ sent: 0 });
  }

  // Filter to slots in the next 60-min window
  const inWindow = (schedules as { id: string; user_id: string; start_time: string }[]).filter((s) => {
    const [h, m] = s.start_time.split(":").map(Number);
    const slotMins = h * 60 + m;
    return slotMins >= currentMins && slotMins < windowEnd;
  });

  if (!inWindow.length) return NextResponse.json({ sent: 0 });

  // Deduplicate: one email per user, using earliest slot in window
  const earliestByUser = new Map<string, { user_id: string; start_time: string }>();
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

  const uniqueUserIds = [...earliestByUser.keys()];
  const { data: users } = await supabase
    .from("users")
    .select("id, email, display_name")
    .in("id", uniqueUserIds)
    .not("email", "is", null);

  const userMap = new Map(
    (users ?? []).map((u: { id: string; email: string; display_name: string | null }) => [u.id, u])
  );

  let sent = 0;
  for (const [userId, slot] of earliestByUser) {
    const user = userMap.get(userId);
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
