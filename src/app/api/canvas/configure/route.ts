import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { updateCanvasIntegration } from "@/lib/db/queries/canvas";
import { z } from "zod";

const configSchema = z.object({
  selectedCourseId: z.string().min(1),
  selectedCourseName: z.string().min(1),
  selectedAssignmentId: z.string().min(1),
  selectedAssignmentName: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    await updateCanvasIntegration(user.id, parsed.data);
  } catch (err) {
    console.error("Canvas configure error:", err);
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
