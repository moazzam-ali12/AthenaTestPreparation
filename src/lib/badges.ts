import { CPA_CORE_SECTIONS, type CpaSection } from "@/types/cpa-exam";
import { CPA_PASSING_SCORE } from "@/lib/cpa-scoring";

export type Badge = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  earned: boolean;
};

export type BadgeInput = {
  questsDone: number;
  bestStreak: number;
  totalScore: number;
  /** Best scaled score (0-99) across all attempted CPA sections. */
  bestSectionScaledScore: number;
  accuracy: number;
  totalTimeSeconds: number;
  /** Whether the user has completed at least one section practice exam. */
  hasSectionExamAttempt: boolean;
  /** CPA sections (AUD/FAR/REG/BAR/ISC/TCP) the user has passed (scaled score >= 75). */
  passedSections: CpaSection[];
  totalXp: number;
};

const BADGE_DEFS: Array<{
  id: string;
  name: string;
  description: string;
  emoji: string;
  check: (i: BadgeInput) => boolean;
}> = [
  {
    id: "first_steps",
    name: "First Steps",
    description: "Complete your first quest",
    emoji: "👣",
    check: (i) => i.questsDone >= 1,
  },
  {
    id: "week_warrior",
    name: "Week Warrior",
    description: "Maintain a 7-day streak",
    emoji: "🔥",
    check: (i) => i.bestStreak >= 7,
  },
  {
    id: "dedicated",
    name: "Dedicated",
    description: "Maintain a 30-day streak",
    emoji: "💪",
    check: (i) => i.bestStreak >= 30,
  },
  {
    id: "sharpshooter",
    name: "Sharpshooter",
    description: "Reach 80% accuracy (10+ quests)",
    emoji: "🎯",
    check: (i) => i.accuracy >= 80 && i.questsDone >= 10,
  },
  {
    id: "marathon",
    name: "Marathon",
    description: "Study for over 1 hour total",
    emoji: "⏱️",
    check: (i) => i.totalTimeSeconds >= 3600,
  },
  {
    id: "test_taker",
    name: "Test Taker",
    description: "Complete a section practice exam",
    emoji: "📝",
    check: (i) => i.hasSectionExamAttempt,
  },
  {
    id: "gold_standard",
    name: "Gold Standard",
    description: `Pass a section practice exam (scaled score ≥ ${CPA_PASSING_SCORE})`,
    emoji: "🥇",
    check: (i) => i.bestSectionScaledScore >= CPA_PASSING_SCORE,
  },
  {
    id: "xp_hunter",
    name: "XP Hunter",
    description: "Earn 100 XP",
    emoji: "⚡",
    check: (i) => i.totalXp >= 100,
  },
  {
    id: "century_club",
    name: "Century Club",
    description: "Complete 100 quests",
    emoji: "💯",
    check: (i) => i.questsDone >= 100,
  },
  {
    id: "diamond_mind",
    name: "Diamond Mind",
    description: "Pass all three core sections (AUD, FAR, REG)",
    emoji: "💎",
    check: (i) =>
      CPA_CORE_SECTIONS.every((section) => i.passedSections.includes(section)),
  },
];

export function computeBadges(input: BadgeInput): Badge[] {
  return BADGE_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    emoji: def.emoji,
    earned: def.check(input),
  }));
}
