import { auth, currentUser } from "@clerk/nextjs/server";
import { createUser, getUserByClerkId } from "@/lib/db/queries/users";
import { sendEmail } from "@/lib/email/send";
import { welcomeEmailHtml } from "@/lib/email/templates";
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

  const user = await createUser({
    clerkId: clerkUser.id,
    email,
    displayName,
    avatarUrl: clerkUser.imageUrl || undefined,
  });

  if (!existingUser && email) {
    const { subject, html } = welcomeEmailHtml({
      displayName: displayName || "there",
    });
    sendEmail({ to: email, subject, html }).catch(console.error);
  }

  return NextResponse.json({ user });
}
