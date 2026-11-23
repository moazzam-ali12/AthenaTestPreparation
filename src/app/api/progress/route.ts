import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getProgressData } from "@/lib/db/queries/progress";
import { getAllSubsectionSkills } from "@/lib/db/queries/subsection-skills";
import { getAllSectionProgress } from "@/lib/db/queries/cpa-exam";
import {
  getOverallLevel,
  getRelevantSections,
  getSubtopicCountsBySection,
} from "@/lib/adaptive/overall-level";
import { getTbsProgress } from "@/lib/db/queries/tbs";
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

  const [data, subsectionSkills, sectionProgress, overallLevel, subtopicCounts, tbsProgress] = await Promise.all([
    getProgressData(user.id),
    getAllSubsectionSkills(user.id),
    getAllSectionProgress(user.id),
    getOverallLevel(user.id),
    getSubtopicCountsBySection(),
    // Never fails the whole page (e.g. before the TBS migration is applied).
    getTbsProgress(user.id).catch((e) => {
      console.error("TBS progress failed:", e);
      return [];
    }),
  ]);

  // Sections that count toward this candidate: the 3 mandatory core
  // sections plus their chosen discipline section (once picked).
  const relevantSections = getRelevantSections(user.targetDisciplineSection ?? null);
  const sectionsPassed = sectionProgress.filter(
    (s) => relevantSections.includes(s.section) && s.passed
  ).length;

  return NextResponse.json({
    user: {
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      targetDisciplineSection: user.targetDisciplineSection ?? null,
      skillScore: user.skillScore ?? null,
    },
    sectionsPassed,
    sectionsTotal: relevantSections.length,
    ...data,
    subsectionSkills,
    overallLevel,
    relevantSections,
    subtopicCounts,
    tbsProgress,
  });
}
