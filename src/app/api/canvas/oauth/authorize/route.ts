import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { buildCanvasAuthUrl, encodeState } from "@/lib/canvas/oauth";

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canvasUrl = req.nextUrl.searchParams.get("canvasUrl");
  if (!canvasUrl) {
    return NextResponse.json({ error: "Missing canvasUrl parameter" }, { status: 400 });
  }

  try {
    const parsed = new URL(canvasUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return NextResponse.json({ error: "Invalid Canvas URL" }, { status: 400 });
  }

  const state = encodeState(canvasUrl);
  const authUrl = buildCanvasAuthUrl(canvasUrl, state);
  return NextResponse.redirect(authUrl);
}
