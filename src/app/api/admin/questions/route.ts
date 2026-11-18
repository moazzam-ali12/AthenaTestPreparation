import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/auth";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/config";
import { ADMIN_SECTIONS, BANK_SOURCES, DIFFICULTIES, PROBLEM_STATUSES } from "@/lib/admin/validation";
import { isUuid, listQuestions } from "@/lib/db/queries/admin";

/** Keeps a query param only if it is one of the allowed values. */
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const GET = adminRoute(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const subtopicId = sp.get("subtopicId");
  const page = Math.max(1, Math.min(10_000, Number(sp.get("page")) || 1));
  const result = await listQuestions({
    q: sp.get("q")?.trim().slice(0, 200) || undefined,
    section: pick(sp.get("section"), ADMIN_SECTIONS),
    subtopicId: subtopicId && isUuid(subtopicId) ? subtopicId : undefined,
    difficulty: pick(sp.get("difficulty"), DIFFICULTIES),
    source: pick(sp.get("source"), BANK_SOURCES),
    status: pick(sp.get("status"), PROBLEM_STATUSES),
    page,
    pageSize: ADMIN_PAGE_SIZE,
  });
  return NextResponse.json({ ...result, page, pageSize: ADMIN_PAGE_SIZE });
});
