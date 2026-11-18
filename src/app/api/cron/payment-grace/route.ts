import { sendGraceReminders } from "@/lib/email/grace-reminders";
import { NextResponse } from "next/server";

// Manual trigger for the grace-period reminder email. The scheduled run happens in the
// notifications cron tick (/api/cron/notifications, pg_cron every 15 min).
// `?dryRun=1` lists who would be emailed without sending.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  try {
    const { sent, userIds } = await sendGraceReminders(new Date(), dryRun);
    return NextResponse.json(dryRun ? { sent, dryRun, userIds } : { sent });
  } catch (err) {
    console.error("Grace reminder cron failed:", err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
