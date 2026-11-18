import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminInputError, adminDb, adminRoute, notFoundJson, readJson } from "@/lib/admin/auth";
import { audited } from "@/lib/admin/audit";

const BodySchema = z.object({ status: z.enum(["new", "triaged", "fixed"]) });

// Admin-only: move a feedback item through new → triaged → fixed.
export const PATCH = adminRoute(async (req: Request, { params }: { params: Promise<{ id: string }> }, admin) => {
  const { id } = await params;
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) throw new AdminInputError("Invalid request");

  const { data: before } = await adminDb.from("feedback").select("status").eq("id", id).maybeSingle();
  if (!before) return notFoundJson();

  const data = await audited(
    admin,
    { action: "feedback.status", targetType: "feedback", targetId: id, before, after: parsed.data },
    async () => {
      const { data, error } = await adminDb
        .from("feedback")
        .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id, status")
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  );
  return NextResponse.json(data);
});
