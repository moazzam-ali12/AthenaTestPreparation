import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getOnboardingProgress } from "@/lib/db/queries/onboarding";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found in DB" }, { status: 404 });
  }

  const onboarding = await getOnboardingProgress(user.id);

  return NextResponse.json({ user, onboarding });
}
