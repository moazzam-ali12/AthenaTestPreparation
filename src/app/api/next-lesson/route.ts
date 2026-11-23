import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getNextLesson, getWeaknessOrderedLessons } from "@/lib/db/queries/next-lesson";
import { getOverallLevel } from "@/lib/adaptive/overall-level";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // ?order=weakest returns the full weakness-ordered study path; default keeps
  // the single fixed-curriculum next lesson for existing callers.
  const order = new URL(req.url).searchParams.get("order");
  if (order === "weakest") {
    const lessons = await getWeaknessOrderedLessons(user.id, user.targetDisciplineSection);
    return NextResponse.json({ lessons });
  }

  const [result, overallLevel] = await Promise.all([
    getNextLesson(user.id, user.targetDisciplineSection),
    getOverallLevel(user.id),
  ]);
  return NextResponse.json({ ...result, overallLevel });
}
