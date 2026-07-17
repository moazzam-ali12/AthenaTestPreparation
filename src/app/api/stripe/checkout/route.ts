import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";

export async function POST() {
  if (!process.env.STRIPE_PRICE_ID) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
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

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 7,
    },
    allow_promotion_codes: true,
    success_url: `${appUrl}/subscribe?checkout=success`,
    cancel_url: `${appUrl}/subscribe`,
    metadata: { clerkId, userId: user.id },
  });

  return NextResponse.json({ url: session.url });
}
