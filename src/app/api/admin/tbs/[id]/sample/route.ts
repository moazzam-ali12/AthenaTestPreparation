import { NextResponse } from "next/server";
import { adminRoute, AdminInputError, notFoundJson } from "@/lib/admin/auth";
import { audited } from "@/lib/admin/audit";
import { currentSectionSample, getTbsForAdmin, setSectionSample } from "@/lib/db/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Makes this approved task the free-trial sample for its section. */
export const POST = adminRoute(async (_req: Request, { params }: Ctx, admin) => {
  const { id } = await params;
  const task = await getTbsForAdmin(id);
  if (!task) return notFoundJson();
  if (task.status !== "approved") throw new AdminInputError("Only an approved task can be the sample");

  const previous = await currentSectionSample(task.section);
  if (previous === id) return NextResponse.json({ ok: true, changed: false });

  await audited(
    admin,
    {
      action: "tbs.set_sample",
      targetType: "tbs",
      targetId: id,
      before: { section: task.section, sampleId: previous },
      after: { section: task.section, sampleId: id },
    },
    () => setSectionSample(task.section, id)
  );
  return NextResponse.json({ ok: true, changed: true });
});
