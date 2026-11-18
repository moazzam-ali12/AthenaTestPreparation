// Node.js runtime Sentry init (route handlers, server components). Loaded from src/instrumentation.ts.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry/options";

Sentry.init(sentryOptions(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN));
