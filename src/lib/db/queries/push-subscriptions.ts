import { supabase } from "@/lib/supabase/client";

type PushSub = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function savePushSubscription(sub: PushSub) {
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: sub.userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
}

export async function deletePushSubscription(userId: string, endpoint: string) {
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) throw error;
}

export async function getPushSubscriptionsByUserId(userId: string) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw error;
  return data ?? [];
}

export async function getAllPushSubscriptions() {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth");
  if (error) throw error;
  return data ?? [];
}
