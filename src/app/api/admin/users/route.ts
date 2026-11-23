import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/auth";
import { searchUsers } from "@/lib/db/queries/admin";

export const GET = adminRoute(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  return NextResponse.json({ users: await searchUsers(q) });
});
