import { supabase } from "@/lib/supabase/client";
import type { Database } from "@/types/supabase";

type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];

function mapSubscription(row: SubscriptionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    status: row.status,
    planType: row.plan_type,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start) : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getSubscriptionByUserId(userId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapSubscription(data) : null;
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle();

  return data ? mapSubscription(data) : null;
}

export async function upsertSubscription(data: {
  userId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  planType: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}) {
  const { data: row } = await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: data.userId,
        stripe_subscription_id: data.stripeSubscriptionId,
        stripe_customer_id: data.stripeCustomerId,
        status: data.status,
        plan_type: data.planType,
        current_period_start: data.currentPeriodStart?.toISOString() ?? null,
        current_period_end: data.currentPeriodEnd?.toISOString() ?? null,
        cancel_at_period_end: data.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    )
    .select()
    .single();

  return row ? mapSubscription(row) : null;
}
