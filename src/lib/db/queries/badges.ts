import { supabase } from "@/lib/supabase/client";
import { getProfileData } from "@/lib/db/queries/profile";
import { getAllSectionProgress } from "@/lib/db/queries/cpa-exam";
import type { CpaSectionStatusEntry } from "@/types/cpa-exam";
import type { BadgeInput } from "@/lib/badges";

type ProfileStats = Awaited<ReturnType<typeof getProfileData>>;

/** Pure assembly of BadgeInput from already-fetched profile + section-progress data. */
export function buildBadgeInput(
  profileData: ProfileStats,
  sectionProgress: CpaSectionStatusEntry[],
  totalXp: number
): BadgeInput {
  const bestSectionScaledScore = sectionProgress.reduce(
    (max, s) => Math.max(max, s.bestScaledScore ?? 0),
    0
  );
  const passedSections = sectionProgress.filter((s) => s.passed).map((s) => s.section);

  return {
    questsDone: profileData.questsDone,
    bestStreak: profileData.bestStreak,
    totalScore: profileData.totalScore,
    bestSectionScaledScore,
    accuracy: profileData.accuracy,
    totalTimeSeconds: profileData.totalTimeSeconds,
    hasSectionExamAttempt: sectionProgress.some((s) => s.attemptsCount > 0),
    passedSections,
    totalXp,
  };
}

/** Fetches profile + section-progress data and assembles the full BadgeInput for a user. */
export async function getBadgeInputForUser(
  userId: string,
  totalXp: number
): Promise<BadgeInput> {
  const [profileData, sectionProgress] = await Promise.all([
    getProfileData(userId),
    getAllSectionProgress(userId),
  ]);

  return buildBadgeInput(profileData, sectionProgress, totalXp);
}

const db = supabase as any;

export async function getEarnedBadgeIds(userId: string): Promise<Set<string>> {
  const { data } = await db
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId);

  return new Set(((data ?? []) as { badge_id: string }[]).map((r) => r.badge_id));
}

export async function recordNewBadges(userId: string, badgeIds: string[]) {
  if (badgeIds.length === 0) return;

  await db
    .from("user_badges")
    .upsert(
      badgeIds.map((badgeId) => ({ user_id: userId, badge_id: badgeId })),
      { onConflict: "user_id,badge_id", ignoreDuplicates: true }
    );
}
