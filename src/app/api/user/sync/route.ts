import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { createUser, getUserByClerkId } from "@/lib/db/queries/users";
import { sendEmail } from "@/lib/email/send";
import { welcomeEmailHtml } from "@/lib/email/templates";
import { INVITE_COOKIE, redeemInvite, type RedeemResult } from "@/lib/beta";
import { track } from "@/lib/analytics";
import { NextResponse } from "next/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const existingUser = await getUserByClerkId(clerkUser.id);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    undefined;

  let user = await createUser({
    clerkId: clerkUser.id,
    email,
    displayName,
    avatarUrl: clerkUser.imageUrl || undefined,
  });

  const cookieStore = await cookies();
  const inviteCode = cookieStore.get(INVITE_COOKIE)?.value;

  if (!existingUser && user) {
    // Beta invite from /sign-up?invite=CODE (validated there, redeemed atomically here).
    let invite: RedeemResult | null = null;
    if (inviteCode) {
      invite = await redeemInvite(inviteCode, user.id);
      if (invite === "ok") user = (await getUserByClerkId(clerkUser.id)) ?? user;
    }
    track("signup", { cohort: user.cohort, invite }, user.id);

    if (email) {
      const { subject, html } = welcomeEmailHtml({
        displayName: displayName || "there",
      });
      sendEmail({ to: email, subject, html }).catch(console.error);
    }
  }

  const res = NextResponse.json({ user });
  if (inviteCode) res.cookies.delete(INVITE_COOKIE);
  return res;
}
