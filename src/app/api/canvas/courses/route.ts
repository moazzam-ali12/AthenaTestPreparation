import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCanvasIntegration } from "@/lib/db/queries/canvas";
import { createCanvasClient } from "@/lib/canvas/client";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const integration = await getCanvasIntegration(user.id);
  if (!integration) {
    return NextResponse.json({ error: "Canvas not connected" }, { status: 400 });
  }

  try {
    const client = createCanvasClient(integration.canvasInstanceUrl, integration.accessToken);
    const courses = await client.getCourses();
    return NextResponse.json({ courses });
  } catch (err) {
    console.error("Canvas courses fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 });
  }
}
