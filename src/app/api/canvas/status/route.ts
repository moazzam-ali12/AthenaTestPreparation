import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCanvasIntegration } from "@/lib/db/queries/canvas";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const integration = await getCanvasIntegration(user.id);
  if (!integration) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    canvasInstanceUrl: integration.canvasInstanceUrl,
    canvasUserName: integration.canvasUserName,
    selectedCourseId: integration.selectedCourseId,
    selectedCourseName: integration.selectedCourseName,
    selectedAssignmentId: integration.selectedAssignmentId,
    selectedAssignmentName: integration.selectedAssignmentName,
    lastSyncedAt: integration.lastSyncedAt?.toISOString() ?? null,
  });
}
