import { NextResponse } from "next/server";
import { adminRoute, AdminInputError, notFoundJson, readJson } from "@/lib/admin/auth";
import { audited, diff, recentAudit } from "@/lib/admin/audit";
import { problemPatchSchema, validateProblem, zodMessage } from "@/lib/admin/validation";
import { getQuestion, updateQuestion } from "@/lib/db/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = adminRoute(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const question = await getQuestion(id);
  if (!question) return notFoundJson();
  return NextResponse.json({ question, audit: await recentAudit("problem", id) });
});

/** Edit and/or change status (approve / reject / archive). Body: any subset of editable fields. */
export const PATCH = adminRoute(async (req: Request, { params }: Ctx, admin) => {
  const { id } = await params;
  const current = await getQuestion(id);
  if (!current) return notFoundJson();

  const parsed = problemPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AdminInputError(zodMessage(parsed.error));
  const errors = validateProblem(current, parsed.data);
  if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  const { before, after, changed } = diff(current as unknown as Record<string, unknown>, parsed.data);
  if (!changed) return NextResponse.json({ ok: true, changed: false });

  const keys = Object.keys(after);
  const action = keys.length === 1 && keys[0] === "status" ? `question.${after.status}` : "question.edit";
  await audited(admin, { action, targetType: "problem", targetId: id, before, after }, () =>
    updateQuestion(id, after)
  );
  return NextResponse.json({ ok: true, changed: true });
});
