import { stripe } from "@/lib/stripe";
import { updateUser } from "@/lib/db/queries/users";
import { upsertSubscription } from "@/lib/db/queries/subscriptions";
import { supabase } from "@/lib/supabase/client";
import { GRACE_PERIOD_DAYS, getCpaPriceIds, planForPriceId } from "@/lib/plans";
import { getAccess, getGraceEndsAt, hasProAccess } from "@/lib/subscription";
import { sendEmail } from "@/lib/email/send";
import { paymentFailedHtml } from "@/lib/email/templates";
import { currentLockedGap, recordStreakFreeze } from "@/lib/db/queries/streak-freezes";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import type Stripe from "stripe";

// Required: disable body parsing so we can verify the raw signature
export const runtime = "nodejs";

// Lower rank wins when a customer has several subscriptions.
const STATUS_RANK: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  incomplete: 4,
  paused: 5,
  canceled: 6,
  incomplete_expired: 7,
};

async function getUserByStripeCustomerId(stripeCustomerId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, clerk_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  return data ?? null;
}

function toDate(seconds: number | undefined) {
  return seconds ? new Date(seconds * 1000) : null;
}

type PrevUserRow = {
  email: string | null;
  display_name: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
  subscription_end_date: string | null;
  payment_failed_at: string | null;
};

/**
 * Records the days a user was locked out as a streak freeze, when they move from
 * expired back to Pro. Runs before the user row is updated, so it still sees the
 * previous (locked) state; later events for an already-Pro user (including one in
 * the failed-payment grace period) are no-ops.
 * Non-fatal: a failure only costs the streak, never the subscription sync.
 */
async function freezeLockedGap(userId: string, prev: PrevUserRow) {
  try {
    const prevAccess = {
      subscriptionStatus: prev.subscription_status,
      trialEndsAt: prev.trial_ends_at,
      createdAt: prev.created_at,
      paymentFailedAt: prev.payment_failed_at,
    };
    const access = getAccess(prevAccess);
    if (access.tier !== "expired") return;

    const gap = currentLockedGap({
      trialEndsAt: access.trialEndsAt,
      subscriptionEndDate: prev.subscription_end_date,
      graceEndsAt: getGraceEndsAt(prevAccess),
    });
    if (gap) await recordStreakFreeze(userId, gap);
  } catch (err) {
    console.error("Streak freeze failed (non-fatal):", err);
  }
}

/** First-failure notice for the grace period. Non-fatal and never retried by Stripe. */
async function sendPaymentFailedEmail(prev: PrevUserRow) {
  if (!prev.email) return;
  try {
    const t = paymentFailedHtml({
      displayName: prev.display_name ?? "there",
      daysLeft: GRACE_PERIOD_DAYS,
      reminder: false,
    });
    await sendEmail({ to: prev.email, subject: t.subject, html: t.html });
  } catch (err) {
    console.error("Payment-failed email failed (non-fatal):", err);
  }
}

/**
 * Recomputes a user's access from every subscription on their Stripe customer,
 * so out-of-order events or a second subscription can't leave the wrong state.
 * Only subscriptions on CPA prices count: this Stripe account also sells other
 * products, and the billing portal can switch a subscription onto them.
 */
async function syncCustomer(customerId: string, userId: string, clerkId: string, eventAt: Date) {
  const cpaPrices = new Set(getCpaPriceIds());
  if (cpaPrices.size === 0) {
    throw new Error("No CPA price IDs configured — cannot determine access");
  }

  const { data: subs } = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  const isCpa = (sub: Stripe.Subscription) =>
    sub.items.data.some((item) => cpaPrices.has(item.price.id));

  // SDK v22: period fields live on items[0], not the subscription root
  await Promise.all(
    subs.map((sub) =>
      upsertSubscription({
        userId,
        stripeSubscriptionId: sub.id,
        stripeCustomerId: customerId,
        status: sub.status,
        planType: isCpa(sub) && hasProAccess(sub.status) ? "pro" : "free",
        currentPeriodStart: toDate(sub.items.data[0]?.current_period_start),
        currentPeriodEnd: toDate(sub.items.data[0]?.current_period_end),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      })
    )
  );

  const best = subs
    .filter(isCpa)
    .sort((a, b) => (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99))[0];
  const status = best?.status ?? "free";
  const planType = hasProAccess(status) ? "pro" : "free";
  const billingPlan = best
    ? (best.items.data.map((i) => planForPriceId(i.price.id)).find(Boolean) ?? null)
    : null;

  const { data: prev } = await supabase
    .from("users")
    .select(
      "email, display_name, subscription_status, trial_ends_at, created_at, subscription_end_date, payment_failed_at"
    )
    .eq("id", userId)
    .maybeSingle();

  const failing = status === "past_due" || status === "unpaid";

  // A locked-out user (trial ended / subscription lapsed / grace ran out) is regaining
  // access: freeze the locked days so their streak continues instead of resetting.
  if (planType === "pro" && prev) await freezeLockedGap(userId, prev);

  await updateUser(clerkId, {
    subscriptionStatus: status,
    planType,
    subscriptionEndDate: toDate(best?.items.data[0]?.current_period_end),
    billingPlan,
  });

  // Analytics: only on a real transition (webhooks often re-sync the same state).
  // past_due is the failed-payment grace period, not churn (and recovering from it isn't a new subscribe).
  const paying = (s: string | null | undefined) => hasProAccess(s) || s === "past_due";
  const wasPaying = paying(prev?.subscription_status);
  if (planType === "pro" && !wasPaying) track("subscribed", { status, plan: billingPlan }, userId);
  if (!paying(status) && wasPaying) track("churned", { status }, userId);

  // Failed-payment spell. payment_failed_at keeps the FIRST failure (it anchors the
  // grace period, see getAccess); the conditional update makes exactly one event —
  // even among concurrent ones — start the spell and send the notice.
  if (failing) {
    const { data: started } = await supabase
      .from("users")
      .update({ payment_failed_at: eventAt.toISOString(), payment_reminder_sent_at: null })
      .eq("id", userId)
      .is("payment_failed_at", null)
      .select("id");
    if (status === "past_due" && started?.length && prev) await sendPaymentFailedEmail(prev);
  } else if (prev?.payment_failed_at) {
    // Paid, canceled or gone: the spell is over.
    await supabase
      .from("users")
      .update({ payment_failed_at: null, payment_reminder_sent_at: null })
      .eq("id", userId);
  }

  // Sync Clerk JWT separately — a Clerk failure shouldn't fail the webhook
  // (Stripe would retry, causing duplicate DB writes)
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(clerkId, {
      publicMetadata: { subscriptionStatus: status, planType },
    });
  } catch (err) {
    console.error("Clerk metadata sync failed (non-fatal):", err);
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook misconfiguration" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: record the event id first. A duplicate delivery (Stripe retries)
  // hits the primary-key conflict and is acknowledged without reprocessing.
  const { error: dedupeErr } = await supabase
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (dedupeErr) {
    if (dedupeErr.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Non-duplicate insert failure: log and continue so we don't drop the event.
    console.error("Failed to record Stripe event for idempotency:", dedupeErr);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "invoice.payment_failed":
      case "invoice.paid": {
        const obj = event.data.object as {
          mode?: string;
          customer?: string | { id: string } | null;
        };
        if (event.type === "checkout.session.completed" && obj.mode !== "subscription") break;
        if (!obj.customer) break;
        const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer.id;

        // Resolve the user from the customer id this app stored at checkout, never
        // from metadata: the shared Stripe account also delivers other apps' events.
        const userRow = await getUserByStripeCustomerId(customerId);
        if (!userRow) break;
        await syncCustomer(customerId, userRow.id, userRow.clerk_id, new Date(event.created * 1000));
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Error handling Stripe event ${event.type}:`, err);
    // Un-record the event so Stripe's retry is processed instead of skipped as a duplicate.
    await supabase.from("stripe_events").delete().eq("id", event.id);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
