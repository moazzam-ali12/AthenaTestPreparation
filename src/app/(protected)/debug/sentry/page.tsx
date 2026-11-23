import { notFound } from "next/navigation";
import { canUseSentryDebug } from "@/lib/sentry/debug-access";
import { SentryDebugButtons } from "./sentry-debug-buttons";

export const dynamic = "force-dynamic";

export default async function SentryDebugPage() {
  if (!(await canUseSentryDebug())) notFound();
  return (
    <div className="mx-auto max-w-md space-y-4 px-6 py-12">
      <h1 className="text-lg font-semibold">Sentry test (staging only)</h1>
      <p className="text-sm text-muted-foreground">
        Each button sends one test error. Check the Sentry project for the matching event.
      </p>
      <SentryDebugButtons />
    </div>
  );
}
