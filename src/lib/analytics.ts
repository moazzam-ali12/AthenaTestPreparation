// Server-side product analytics. Writes to the `events` table (see
// supabase/migrations/20261119100000_beta_launch.sql). Never import from client code;
// the browser reports the few client-side events through POST /api/events.
import { after } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { sanitizeProps, type EventName, type EventProps } from "./analytics-props";

export { EVENT_NAMES, type EventName } from "./analytics-props";

type EventRow = { user_id: string | null; name: EventName; props: EventProps; created_at: string };

let buffer: EventRow[] = [];
let flushScheduled = false;

/** Insert everything buffered so far in one round-trip. Never throws. */
export async function flushEvents(): Promise<void> {
  flushScheduled = false;
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("events").insert(rows);
    if (error) console.error(`analytics: dropped ${rows.length} event(s): ${error.message}`);
  } catch (e) {
    console.error(`analytics: dropped ${rows.length} event(s):`, e);
  }
}

/**
 * Record a product event. Fire-and-forget: buffers the row and flushes once per
 * request (via `after()`, so it runs after the response and never adds latency),
 * batching every event tracked in the same request into a single insert.
 * Props are sanitized (flat primitives, no PII-looking keys/values).
 */
export function track(name: EventName, props: Record<string, unknown> = {}, userId: string | null = null): void {
  try {
    buffer.push({ user_id: userId, name, props: sanitizeProps(props), created_at: new Date().toISOString() });
    if (flushScheduled) return;
    flushScheduled = true;
    try {
      after(flushEvents);
    } catch {
      // Outside a request scope (scripts/tests): flush on the next tick instead.
      setTimeout(() => void flushEvents(), 0);
    }
  } catch (e) {
    console.error("analytics: track failed:", e);
  }
}
