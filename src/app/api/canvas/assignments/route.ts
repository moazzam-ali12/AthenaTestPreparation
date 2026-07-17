import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCanvasIntegration } from "@/lib/db/queries/canvas";
import { createCanvasClient } from "@/lib/canvas/client";

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const courseId = req.nextUrl.searchParams.get("courseId");
  if (!courseId) return NextResponse.json({ error: "Missing courseId" }, { status: 400 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const integration = await getCanvasIntegration(user.id);
  if (!integration) {
    return NextResponse.json({ error: "Canvas not connected" }, { status: 400 });
  }

  try {
    const client = createCanvasClient(integration.canvasInstanceUrl, integration.accessToken);
    const assignments = await client.getAssignments(courseId);
    return NextResponse.json({ assignments });
  } catch (err) {
    console.error("Canvas assignments fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch assignments" }, { status: 500 });
  }
}
