/**
 * Shared Sentry init options for the browser, Node and edge runtimes.
 *
 * - Disabled when no DSN is set (local dev).
 * - Errors 100%, traces 10% by default; override with SENTRY_SAMPLE_RATE /
 *   SENTRY_TRACES_SAMPLE_RATE (exposed to the browser through next.config.ts).
 * - Release is injected at build time by withSentryConfig (git SHA).
 */
import { scrubBreadcrumb, scrubEvent } from "./scrub";

function rate(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: !!dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || "development",
    sampleRate: rate(process.env.NEXT_PUBLIC_SENTRY_SAMPLE_RATE, 1),
    tracesSampleRate: rate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.1),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
