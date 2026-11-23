// Browser Sentry init (loaded by Next.js before the app hydrates).
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";

Sentry.init({
  ...sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN),
  // No session replay: it would record learners' answers on screen.
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
