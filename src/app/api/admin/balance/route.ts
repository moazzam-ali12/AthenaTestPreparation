import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/auth";
import { getBalance } from "@/lib/db/queries/admin";

export const GET = adminRoute(async () => {
  return NextResponse.json(await getBalance());
});
