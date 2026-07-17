import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getActiveTestsForSection,
  getSectionProgress,
  getInProgressAttempt,
} from "@/lib/db/queries/cpa-exam";
import type { CpaSection, CpaExamStatusResponse } from "@/types/cpa-exam";
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
  const section = searchParams.get("section") as CpaSection | null;

  if (!section || !VALID_SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Valid section is required" }, { status: 400 });
  }

  const [tests, progress, currentAttempt] = await Promise.all([
    getActiveTestsForSection(section),
    getSectionProgress(user.id, section),
    getInProgressAttempt(user.id, section),
  ]);

  const response: CpaExamStatusResponse = {
    section,
    tests,
    progress,
    canStartNewAttempt: !currentAttempt,
    currentAttempt,
  };

  return NextResponse.json(response);
}
