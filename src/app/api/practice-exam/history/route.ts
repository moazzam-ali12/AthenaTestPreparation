import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getUserAttempts } from "@/lib/db/queries/cpa-exam";
import type { CpaSection, CpaExamHistoryResponse } from "@/types/cpa-exam";
import { NextResponse } from "next/server";

const VALID_SECTIONS: CpaSection[] = ["AUD", "FAR", "REG", "BAR", "ISC", "TCP"];

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const sectionParam = searchParams.get("section") as CpaSection | null;
  const section =
    sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : undefined;

  const attempts = await getUserAttempts(user.id, section);

  const response: CpaExamHistoryResponse = { attempts };
  return NextResponse.json(response);
}
