import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/auth";
import { listSubtopicsForAdmin } from "@/lib/db/queries/admin";

export const GET = adminRoute(async () => {
  return NextResponse.json({ subtopics: await listSubtopicsForAdmin() });
});
