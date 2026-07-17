import { stripe } from "@/lib/stripe";
import { updateUser } from "@/lib/db/queries/users";
import { upsertSubscription } from "@/lib/db/queries/subscriptions";
import { supabase } from "@/lib/supabase/client";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

// Required: disable body parsing so we can verify the raw signature
export const runtime = "nodejs";

async function getUserByStripeCustomerId(stripeCustomerId: string) {
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  return data ?? null;
}

async function syncSubscriptionToUser(
  sub: Stripe.Subscription,
  userId: string,
  clerkId: string
) {
  const status = sub.status; // active, canceled, past_due, etc.
  const isActive = status === "active" || status === "trialing";
  const planType = isActive ? "pro" : "free";
  // SDK v22: period fields live on items[0], not the subscription root
  const item = sub.items.data[0];
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  // Run DB writes first — these are critical
  await Promise.all([
    updateUser(clerkId, {
      subscriptionStatus: status,
      planType,
      subscriptionEndDate: periodEnd,
    }),
    upsertSubscription({
      userId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
      status,
      planType,
      currentPeriodStart: item?.current_period_start
        ? new Date(item.current_period_start * 1000)
        : null,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    }),
  ]);

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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const clerkId = session.metadata?.clerkId;
        const userId = session.metadata?.userId;
        if (!clerkId || !userId) break;

        const sub = await stripe.subscriptions.retrieve(
          session.subscription as string
        );
        await syncSubscriptionToUser(sub, userId, clerkId);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userRow = await getUserByStripeCustomerId(sub.customer as string);
        if (!userRow) break;
        await syncSubscriptionToUser(sub, userRow.id, userRow.clerk_id);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userRow = await getUserByStripeCustomerId(sub.customer as string);
        if (!userRow) break;
        await syncSubscriptionToUser(sub, userRow.id, userRow.clerk_id);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const rawSub = (invoice as any).subscription as string | Stripe.Subscription | null;
        const subId = typeof rawSub === "string" ? rawSub : (rawSub?.id ?? null);
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const userRow = await getUserByStripeCustomerId(sub.customer as string);
        if (!userRow) break;
        await syncSubscriptionToUser(sub, userRow.id, userRow.clerk_id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Error handling Stripe event ${event.type}:`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
