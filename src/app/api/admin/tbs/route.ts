import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/auth";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/config";
import { ADMIN_SECTIONS, TBS_STATUSES } from "@/lib/admin/validation";
import { listTbs } from "@/lib/db/queries/admin";

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const GET = adminRoute(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Math.min(10_000, Number(sp.get("page")) || 1));
  const result = await listTbs({
    section: pick(sp.get("section"), ADMIN_SECTIONS),
    status: pick(sp.get("status"), TBS_STATUSES),
    q: sp.get("q")?.trim().slice(0, 200) || undefined,
    page,
    pageSize: ADMIN_PAGE_SIZE,
  });
  return NextResponse.json({ ...result, page, pageSize: ADMIN_PAGE_SIZE });
});
