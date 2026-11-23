import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { track } from "@/lib/analytics";
import { CLIENT_EVENT_NAMES, isEventName } from "@/lib/analytics-props";

// Client-reported analytics events. Only CLIENT_EVENT_NAMES are accepted; all other
// events are tracked server-side where they happen. Props are sanitized in track().
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; props?: unknown } | null;
  if (!body || !isEventName(body.name) || !CLIENT_EVENT_NAMES.includes(body.name)) {
    return NextResponse.json({ error: "Unknown event" }, { status: 400 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  track(body.name, (body.props ?? {}) as Record<string, unknown>, user.id);
  return new NextResponse(null, { status: 204 });
}
