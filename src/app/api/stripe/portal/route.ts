import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { stripe } from "@/lib/stripe";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  }

  // Return to the domain the user is actually on, so a stale APP_URL can't send them to localhost.
  const appUrl = new URL(req.url).origin;

  // The account's default portal config is shared with other apps and allows
  // switching onto their products, so use a CPA-only config when one is set.
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined;

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/billing`,
    ...(configuration && { configuration }),
  });

  return NextResponse.json({ url: portalSession.url });
}
