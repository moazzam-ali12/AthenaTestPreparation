import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getGoals, upsertGoal, type GoalType } from "@/lib/db/queries/goals";
import { NextResponse } from "next/server";

const VALID_GOAL_TYPES: GoalType[] = ["weekly_xp", "accuracy_target", "streak_days"];

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const goals = await getGoals(user.id);
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: { goalType?: string; targetValue?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { goalType, targetValue } = body;
  if (
    !goalType ||
    !VALID_GOAL_TYPES.includes(goalType as GoalType) ||
    typeof targetValue !== "number" ||
    targetValue <= 0
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await upsertGoal(user.id, goalType as GoalType, targetValue);
  const goals = await getGoals(user.id);
  return NextResponse.json({ goals });
}
