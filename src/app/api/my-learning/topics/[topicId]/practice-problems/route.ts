import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCustomTopicWithQuestions } from "@/lib/db/queries/custom-learning";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { topicId } = await params;
  const result = await getCustomTopicWithQuestions(topicId, user.id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Source practice problems from the questions already generated for this
  // custom topic (problems table, source='custom'). My Learning is a general
  // "learn anything" feature, so we do NOT route through the CPA-exam
  // /practice-problems generator (which forces aud|far|reg|bar|isc|tcp framing).
  // These rows are persisted at topic-creation time — no generation happens
  // here, so the P2 goal (never regenerate on GET) holds inherently.
  return NextResponse.json({ problems: result.questions });
}
