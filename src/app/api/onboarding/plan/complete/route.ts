import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { upsertOnboardingProgress } from "@/lib/db/queries/onboarding";
import { upsertUserPreferences } from "@/lib/db/queries/preferences";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await req.json();
  const { name, grade, learnerTypes, interests, strugglingTopic, targetDisciplineSection } = body;

  await upsertUserPreferences(user.id, {
    name,
    grade,
    learnerTypes,
    interests,
    strugglingTopic,
  });

  if (
    targetDisciplineSection === "BAR" ||
    targetDisciplineSection === "ISC" ||
    targetDisciplineSection === "TCP"
  ) {
    await updateUser(clerkId, { targetDisciplineSection });
  }

  await upsertOnboardingProgress(user.id, { currentStep: "quiz" });

  return NextResponse.json({ success: true });
}
