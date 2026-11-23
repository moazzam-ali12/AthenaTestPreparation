import { supabase } from "@/lib/supabase/client";
import { getAllSubsectionSkills } from "@/lib/db/queries/subsection-skills";
import { getSectionLevels, isReadyForOverallLevelUp } from "@/lib/adaptive/engine";
import { CPA_CORE_SECTIONS, type CpaSection } from "@/types/cpa-exam";

// users.overall_level isn't in the generated Supabase types yet, hence `as any`.

async function getUserLevelRow(userId: string) {
  type Row = { overall_level?: number | null; target_discipline_section: CpaSection | null };
  let { data, error } = (await (supabase as any)
    .from("users")
    .select("overall_level, target_discipline_section")
    .eq("id", userId)
    .maybeSingle()) as { data: Row | null; error: unknown };

  // Before the overall_level migration is applied the column doesn't exist;
  // still return the discipline so section scoping stays correct.
  if (error) {
    ({ data } = (await supabase
      .from("users")
      .select("target_discipline_section")
      .eq("id", userId)
      .maybeSingle()) as { data: Row | null });
  }

  return {
    overallLevel: data?.overall_level ?? 1,
    targetDisciplineSection: data?.target_discipline_section ?? null,
  };
}

export async function getOverallLevel(userId: string): Promise<number> {
  return (await getUserLevelRow(userId)).overallLevel;
}

/** Number of subtopics in each CPA section's curriculum. */
export async function getSubtopicCountsBySection(): Promise<Partial<Record<CpaSection, number>>> {
  const { data } = await supabase.from("subtopics").select("id, topics!inner(subject)");
  const counts: Partial<Record<CpaSection, number>> = {};
  for (const row of data ?? []) {
    const subject = (row.topics as unknown as { subject: string } | null)?.subject;
    if (!subject) continue;
    const section = subject.toUpperCase() as CpaSection;
    counts[section] = (counts[section] ?? 0) + 1;
  }
  return counts;
}

/** AUD, FAR, REG plus the candidate's discipline (once chosen). */
export function getRelevantSections(targetDisciplineSection: CpaSection | null): CpaSection[] {
  return targetDisciplineSection
    ? [...CPA_CORE_SECTIONS, targetDisciplineSection]
    : CPA_CORE_SECTIONS;
}

/**
 * Call after any skill update. If every relevant section is maxed (level 10
 * with at least SECTION_COVERAGE_REQUIRED of its subtopics practiced),
 * bumps users.overall_level by one and resets every subsection skill to
 * level 1. Returns the new overall level, or null if nothing changed.
 */
export async function checkOverallLevelUp(userId: string): Promise<number | null> {
  const [{ overallLevel, targetDisciplineSection }, skills, subtopicCounts] = await Promise.all([
    getUserLevelRow(userId),
    getAllSubsectionSkills(userId),
    getSubtopicCountsBySection(),
  ]);
  const sectionLevels = getSectionLevels(
    skills,
    getRelevantSections(targetDisciplineSection),
    subtopicCounts
  );

  if (!isReadyForOverallLevelUp(sectionLevels)) return null;

  // Conditional on the current value so two answers landing at once can't
  // promote twice.
  const { data: promoted, error } = (await (supabase as any)
    .from("users")
    .update({ overall_level: overallLevel + 1 })
    .eq("id", userId)
    .eq("overall_level", overallLevel)
    .select("id")) as { data: { id: string }[] | null; error: { message: string } | null };

  if (error) throw new Error(error.message);
  if (!promoted || promoted.length === 0) return null;

  // Fresh start at the new overall level. Attempt counts and the last-10
  // window are kept (analytics read them); streaks reset so each subtopic
  // level is earned again.
  const { error: resetError } = await (supabase as any)
    .from("subsection_skills")
    .update({
      level: 1,
      streak_correct: 0,
      streak_wrong: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (resetError) throw new Error(resetError.message);

  return overallLevel + 1;
}
