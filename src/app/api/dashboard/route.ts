import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getDashboardData } from "@/lib/db/queries/dashboard";
import { getAllSectionProgress } from "@/lib/db/queries/cpa-exam";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import { NextResponse } from "next/server";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [data, sectionProgress] = await Promise.all([
    getDashboardData(user.id),
    getAllSectionProgress(user.id),
  ]);

  // Sections that count toward this candidate: the 3 mandatory core
  // sections plus their chosen discipline section (once picked).
  const relevantSections = user.targetDisciplineSection
    ? [...CPA_CORE_SECTIONS, user.targetDisciplineSection]
    : CPA_CORE_SECTIONS;
  const sectionsPassed = sectionProgress.filter(
    (s) => relevantSections.includes(s.section) && s.passed
  ).length;

  return NextResponse.json({
    user: {
      displayName: user.displayName,
      skillScore: user.skillScore,
      avatarUrl: user.avatarUrl,
      targetDisciplineSection: user.targetDisciplineSection ?? null,
      totalXp: user.totalXp ?? 0,
      bestStreak: user.bestStreak ?? 0,
    },
    sectionsPassed,
    sectionsTotal: relevantSections.length,
    ...data,
  });
}
