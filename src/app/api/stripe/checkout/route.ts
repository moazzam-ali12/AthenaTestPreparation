import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { stripe } from "@/lib/stripe";
import { DEFAULT_PLAN, getPriceId, isPlanId } from "@/lib/plans";
import { hasProAccess } from "@/lib/subscription";
import { track } from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve the requested plan → price ID (multi-plan; no hard-coded price).
  const body = await req.json().catch(() => ({}));
  const plan = isPlanId((body as { plan?: unknown }).plan)
    ? (body as { plan: "monthly" | "annual" }).plan
    : DEFAULT_PLAN;
  const priceId = getPriceId(plan);
  if (!priceId) {
    return NextResponse.json({ error: "Selected plan is not available" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (hasProAccess(user.subscriptionStatus)) {
    return NextResponse.json({ error: "Already subscribed" }, { status: 409 });
  }
  // A failing payment is fixed in the billing portal, not with a second subscription.
  if (user.subscriptionStatus === "past_due" || user.subscriptionStatus === "unpaid") {
    return NextResponse.json(
      { error: "Please update your payment method in Billing" },
      { status: 409 }
    );
  }

  // Reuse existing Stripe customer or create one
  let customerId = user.stripeCustomerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName ?? undefined,
      metadata: { clerkId, userId: user.id },
    });
    customerId = customer.id;
    await updateUser(clerkId, { stripeCustomerId: customerId });
  }

  // Return to the domain the user is actually on, so a stale APP_URL can't send them to localhost.
  const appUrl = new URL(req.url).origin;

  // Stripe Tax must be activated in the Dashboard before turning this on; with it,
  // Checkout collects a billing address and saves it to the customer for renewals.
  const taxEnabled = process.env.STRIPE_TAX_ENABLED === "true";

  // No payment_method_types: Checkout then offers every method enabled in the
  // Dashboard (cards, Apple Pay, Google Pay, Link, …).
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    ...(taxEnabled && {
      automatic_tax: { enabled: true },
      billing_address_collection: "required" as const,
      customer_update: { address: "auto" as const, name: "auto" as const },
    }),
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    allow_promotion_codes: true,
    success_url: `${appUrl}/subscribe?checkout=success`,
    cancel_url: `${appUrl}/subscribe`,
    metadata: { clerkId, userId: user.id, plan },
  });

  track("checkout_started", { plan }, user.id);
  return NextResponse.json({ url: session.url });
}
