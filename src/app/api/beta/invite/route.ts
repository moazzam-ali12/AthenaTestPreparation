import { NextResponse } from "next/server";
import { checkInvite, INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, INVITE_ERROR_COPY, normalizeInviteCode } from "@/lib/beta";

// Public: /sign-up?invite=CODE checks the code here before the Clerk flow. A valid code is
// parked in an httpOnly cookie; the first /api/user/sync redeems it (atomically) and tags
// the new user as cohort 'beta'. Checking does not consume a use.
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("code");
  const status = await checkInvite(raw);

  if (status !== "ok") {
    const res = NextResponse.json({ valid: false, status, message: INVITE_ERROR_COPY[status] });
    res.cookies.delete(INVITE_COOKIE);
    return res;
  }

  const res = NextResponse.json({ valid: true, status });
  res.cookies.set(INVITE_COOKIE, normalizeInviteCode(raw)!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE,
  });
  return res;
}
