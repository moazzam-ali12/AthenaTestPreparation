import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { saveAttemptResponses } from "@/lib/db/queries/tbs";
import { attemptBodySchema, loadTaskAndAttempt, pickTaskResponses } from "@/lib/tbs/server";

/** PUT /api/tbs/[id]/attempt — autosave the in-progress responses. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const parsed = attemptBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await params;
  const loaded = await loadTaskAndAttempt(user, id);
  if (loaded instanceof NextResponse) return loaded;

  await saveAttemptResponses(
    loaded.attempt.id,
    pickTaskResponses(loaded.task, parsed.data.responses),
    parsed.data.timeSpentSeconds
  );
  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}
