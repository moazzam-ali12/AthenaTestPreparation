import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCanvasIntegration, deleteCanvasIntegration } from "@/lib/db/queries/canvas";

export async function DELETE() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const integration = await getCanvasIntegration(user.id);
  if (integration) {
    // Best-effort token revocation from Canvas
    try {
      await fetch(`${integration.canvasInstanceUrl}/login/oauth2/token`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${integration.accessToken}` },
      });
    } catch {
      // Ignore revocation errors; local record is still removed
    }
    await deleteCanvasIntegration(user.id);
  }

  return NextResponse.json({ ok: true });
}
