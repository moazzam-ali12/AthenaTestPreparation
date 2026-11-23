import { auth } from "@clerk/nextjs/server";

/**
 * Sentry test endpoints are staging-only: never available when
 * SENTRY_ENVIRONMENT=production (or unset on a Vercel production deploy),
 * and always require a signed-in user.
 */
export async function canUseSentryDebug(): Promise<boolean> {
  const env = process.env.SENTRY_ENVIRONMENT || (process.env.VERCEL_ENV === "production" ? "production" : "");
  if (env === "production") return false;
  const { userId } = await auth();
  return !!userId;
}
