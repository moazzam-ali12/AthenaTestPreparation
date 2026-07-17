import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { upsertOnboardingProgress } from "@/lib/db/queries/onboarding";
import { NextResponse } from "next/server";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await upsertOnboardingProgress(user.id, { currentStep: "completed" });
  await updateUser(clerkId, { onboardingCompleted: true });

  return NextResponse.json({ ok: true });
}
