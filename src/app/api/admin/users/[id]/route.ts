import { NextResponse } from "next/server";
import { adminRoute, notFoundJson } from "@/lib/admin/auth";
import { recentAudit } from "@/lib/admin/audit";
import { getUserDetailForAdmin } from "@/lib/db/queries/admin";

type Ctx = { params: Promise<{ id: string }> };

export const GET = adminRoute(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const user = await getUserDetailForAdmin(id);
  if (!user) return notFoundJson();
  return NextResponse.json({ user, audit: await recentAudit("user", id) });
});
