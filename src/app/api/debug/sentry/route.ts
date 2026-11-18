import { NextResponse } from "next/server";
import { canUseSentryDebug } from "@/lib/sentry/debug-access";

export const dynamic = "force-dynamic";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

/**
 * GET /api/debug/sentry            → throws, so the error reaches Sentry via onRequestError.
 * GET /api/debug/sentry?target=agents → asks the agents backend to throw (its own Sentry event).
 * Staging-only + signed-in (see canUseSentryDebug); 404 otherwise.
 */
export async function GET(req: Request) {
  if (!(await canUseSentryDebug())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (new URL(req.url).searchParams.get("target") === "agents") {
    const res = await fetch(`${AGENT_URL}/debug/sentry`).catch(() => null);
    return NextResponse.json({ agentsStatus: res?.status ?? "unreachable" });
  }

  throw new Error(`Sentry test error from API route (${new Date().toISOString()})`);
}
