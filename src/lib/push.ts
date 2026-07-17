// Server-side push notification helper (imported by API routes and crons)
import webpush from "web-push";
import {
  getPushSubscriptionsByUserId,
  deletePushSubscription,
} from "@/lib/db/queries/push-subscriptions";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

let vapidConfigured = false;
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    `mailto:${process.env.EMAIL_FROM ?? "hello@athena.app"}`,
    vapidPublicKey,
    vapidPrivateKey
  );
  vapidConfigured = true;
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!vapidConfigured) return { sent: 0, failed: 0 };

  const subs = await getPushSubscriptionsByUserId(userId);
  if (!subs.length) return { sent: 0, failed: 0 };

  const payloadStr = JSON.stringify({ url: "/dashboard", ...payload });
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadStr
        );
        sent++;
      } catch (err: any) {
        failed++;
        // 410 Gone = endpoint expired; remove it to keep the table clean
        if (err?.statusCode === 410) {
          await deletePushSubscription(userId, s.endpoint).catch(() => {});
        }
      }
    })
  );

  return { sent, failed };
}
