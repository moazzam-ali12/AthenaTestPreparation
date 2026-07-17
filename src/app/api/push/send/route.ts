import { NextResponse } from "next/server";
import { sendPushToUser } from "@/lib/push";
import { getAllPushSubscriptions } from "@/lib/db/queries/push-subscriptions";
import { z } from "zod";

const bodySchema = z.object({
  userId: z.string().optional(), // if omitted, sends to all subscribers
  title: z.string(),
  body: z.string(),
  url: z.string().optional(),
});

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron not configured" }, { status: 500 });
  const secret = req.headers.get("x-cron-secret");
  if (secret !== cronSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { userId, title, body, url = "/dashboard" } = parsed.data;

  if (userId) {
    const result = await sendPushToUser(userId, { title, body, url });
    console.log(`[push/send] user=${userId} sent=${result.sent} failed=${result.failed}`);
    return NextResponse.json(result);
  }

  // Broadcast to all subscribers
  const allSubs = await getAllPushSubscriptions();
  const userIds = [...new Set(allSubs.map((s) => s.user_id))];

  let totalSent = 0;
  let totalFailed = 0;
  await Promise.allSettled(
    userIds.map(async (uid) => {
      const r = await sendPushToUser(uid, { title, body, url });
      totalSent += r.sent;
      totalFailed += r.failed;
    })
  );

  console.log(
    `[push/send] broadcast sent=${totalSent} failed=${totalFailed} users=${userIds.length}`
  );
  return NextResponse.json({ sent: totalSent, failed: totalFailed });
}
