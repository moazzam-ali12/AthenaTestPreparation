import { NextResponse } from "next/server";
import { adminDb, adminRoute, AdminInputError, notFoundJson, readJson } from "@/lib/admin/auth";
import { audited, diff, recentAudit } from "@/lib/admin/audit";
import { tbsPatchSchema, validateTbsKey, zodMessage } from "@/lib/admin/validation";
import { getTbsForAdmin, parseTbsShape, updateTbs } from "@/lib/db/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = adminRoute(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const task = await getTbsForAdmin(id);
  if (!task) return notFoundJson();
  const shape = parseTbsShape(task);
  const keyErrors =
    shape.fields.success ? validateTbsKey(shape.fields.data, shape.key.success ? shape.key.data : null) : ["Fields are invalid"];
  return NextResponse.json({ task, keyErrors, audit: await recentAudit("tbs", id) });
});

/** Edit and/or approve / reject. Body: any subset of editable fields, answer_key, status. */
export const PATCH = adminRoute(async (req: Request, { params }: Ctx, admin) => {
  const { id } = await params;
  const current = await getTbsForAdmin(id);
  if (!current) return notFoundJson();

  const parsed = tbsPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AdminInputError(zodMessage(parsed.error));
  const patch = parsed.data;

  const merged = { ...current, ...patch };
  const shape = parseTbsShape(merged);
  if (!shape.exhibits.success) throw new AdminInputError("Exhibits are invalid");
  if (!shape.fields.success) throw new AdminInputError("Fields are invalid");
  // Approved tasks (or edits to fields / key) must have a complete, consistent key.
  if (merged.status === "approved" || patch.fields || patch.answer_key) {
    const errors = validateTbsKey(shape.fields.data, shape.key.success ? shape.key.data : null);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  if (patch.subtopic_id) {
    const { data: sub } = await adminDb
      .from("subtopics")
      .select("id, topics!inner(subject)")
      .eq("id", patch.subtopic_id)
      .maybeSingle();
    if (!sub) throw new AdminInputError("Unknown subtopic");
    if (sub.topics.subject !== current.section) throw new AdminInputError("Subtopic is in another section");
  }

  const taskFields: Record<string, unknown> = { ...patch };
  delete taskFields.answer_key;
  // A rejected/draft task cannot stay the section sample.
  if (patch.status && patch.status !== "approved" && current.is_sample) taskFields.is_sample = false;

  const { before, after, changed } = diff(
    current as unknown as Record<string, unknown>,
    { ...taskFields, ...(patch.answer_key ? { answer_key: patch.answer_key } : {}) }
  );
  if (!changed) return NextResponse.json({ ok: true, changed: false });

  const keys = Object.keys(after).filter((k) => k !== "is_sample");
  const action = keys.length === 1 && keys[0] === "status" ? `tbs.${after.status}` : "tbs.edit";
  const { answer_key: changedKey, ...changedTask } = after;
  await audited(admin, { action, targetType: "tbs", targetId: id, before, after }, () =>
    updateTbs(id, changedTask, changedKey === undefined ? undefined : changedKey)
  );
  return NextResponse.json({ ok: true, changed: true });
});
