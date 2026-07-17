import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getQueueItemByUserAndLesson,
  updateQueueItemStatus,
} from "@/lib/db/queries/learning-queue";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { lessonId } = await params;
  const body = await req.json();
  const { progressPct, status } = body as {
    progressPct: number;
    status: "pending" | "in_progress" | "completed";
  };

  const queueItem = await getQueueItemByUserAndLesson(user.id, lessonId);
  if (!queueItem) {
    return NextResponse.json(
      { error: "Lesson not in queue" },
      { status: 404 }
    );
  }

  const updated = await updateQueueItemStatus(
    queueItem.id,
    status,
    progressPct
  );

  return NextResponse.json({ item: updated });
}
