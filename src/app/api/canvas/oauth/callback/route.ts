import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, decodeState } from "@/lib/canvas/oauth";
import { saveCanvasIntegration } from "@/lib/db/queries/canvas";
import { getUserByClerkId } from "@/lib/db/queries/users";

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.redirect(`${APP_URL}/sign-in`);
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      `${APP_URL}/settings?canvas_error=${encodeURIComponent(errorParam)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/settings?canvas_error=missing_params`);
  }

  let canvasUrl: string;
  try {
    ({ canvasUrl } = decodeState(state));
  } catch {
    return NextResponse.redirect(`${APP_URL}/settings?canvas_error=invalid_state`);
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.redirect(`${APP_URL}/settings?canvas_error=user_not_found`);
  }

  try {
    const tokens = await exchangeCodeForTokens(canvasUrl, code);
    await saveCanvasIntegration({
      userId: user.id,
      canvasInstanceUrl: canvasUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.tokenExpiresAt,
      canvasUserId: tokens.canvasUserId,
      canvasUserName: tokens.canvasUserName,
      canvasUserEmail: tokens.canvasUserEmail,
    });
  } catch (err) {
    console.error("Canvas OAuth callback error:", err);
    return NextResponse.redirect(`${APP_URL}/settings?canvas_error=token_exchange_failed`);
  }

  return NextResponse.redirect(`${APP_URL}/settings?canvas_connected=1`);
}
