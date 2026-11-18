import type { SubsectionSkill, QuestBucket } from "@/types/adaptive";

// --- Accuracy ---

export function computeLast10Accuracy(last10: boolean[]): number {
  if (last10.length === 0) return 0;
  const correct = last10.filter(Boolean).length;
  return (correct / last10.length) * 100;
}

// --- Adaptive Level ---

// Minimum answers in the window before accuracy can justify a level-up, so a
// single correct answer (100% of a 1-answer window) can't promote.
const MIN_ANSWERS_FOR_LEVEL_UP = 5;
// Consecutive challenging correct answers needed per level-up. Streaks reset
// on every level change, so each new level has to be earned from scratch.
const STREAK_FOR_LEVEL_UP = 3;
const STREAK_FOR_LEVEL_DOWN = 2;

/**
 * A question only counts toward promotion if it isn't far below the
 * candidate's current level — acing easy (3) questions shouldn't carry
 * someone to level 9. Seeded difficulties are 3/5/8, so "level - 1" lets each
 * tier promote into the next one.
 */
export function isChallenging(difficultyLevel: number, level: number): boolean {
  return difficultyLevel >= level - 1;
}

export function computeAdaptiveLevel(skill: SubsectionSkill): number {
  const accuracy = computeLast10Accuracy(skill.last10);

  // Level down is checked first so a wrong answer can never promote.
  if (skill.streakWrong >= STREAK_FOR_LEVEL_DOWN) {
    // Sustained struggle on a full window drops two levels instead of one.
    const drop = skill.last10.length >= 10 && accuracy <= 40 ? 2 : 1;
    return clamp(skill.level - drop, 1, 10);
  }

  if (
    skill.last10.length >= MIN_ANSWERS_FOR_LEVEL_UP &&
    accuracy >= 80 &&
    skill.streakCorrect >= STREAK_FOR_LEVEL_UP
  ) {
    return clamp(skill.level + 1, 1, 10);
  }

  return skill.level;
}

// --- XP ---

export function computeXpForDifficulty(difficultyLevel: number): number {
  if (difficultyLevel >= 9) return 40;
  if (difficultyLevel >= 7) return 20;
  if (difficultyLevel >= 4) return 10;
  return 5;
}

// --- Skill Update After Answer ---

export type SkillMutations = {
  level: number;
  xp: number;
  totalAttempts: number;
  correctAttempts: number;
  last10: boolean[];
  streakCorrect: number;
  streakWrong: number;
  lastSeenAt: string;
};

export function updateSkillAfterAnswer(
  skill: SubsectionSkill,
  isCorrect: boolean,
  difficultyLevel: number
): SkillMutations {
  // Update last10: push new result, keep max 10
  const newLast10 = [...skill.last10, isCorrect].slice(-10);

  // Update streaks. A correct answer on a question well below the current
  // level keeps the streak alive but doesn't extend it.
  const streakCorrect = isCorrect
    ? skill.streakCorrect + (isChallenging(difficultyLevel, skill.level) ? 1 : 0)
    : 0;
  const streakWrong = isCorrect ? 0 : skill.streakWrong + 1;

  // Update attempts
  const totalAttempts = skill.totalAttempts + 1;
  const correctAttempts = skill.correctAttempts + (isCorrect ? 1 : 0);

  // Compute new level using updated state
  const updatedSkill: SubsectionSkill = {
    ...skill,
    last10: newLast10,
    streakCorrect,
    streakWrong,
    totalAttempts,
    correctAttempts,
  };
  const newLevel = computeAdaptiveLevel(updatedSkill);
  // Cooldown: after any level change, the next move needs a fresh streak.
  const levelChanged = newLevel !== skill.level;

  // Compute XP earned
  const xpEarned = isCorrect ? computeXpForDifficulty(difficultyLevel) : 0;

  return {
    level: newLevel,
    xp: skill.xp + xpEarned,
    totalAttempts,
    correctAttempts,
    last10: newLast10,
    streakCorrect: levelChanged ? 0 : streakCorrect,
    streakWrong: levelChanged ? 0 : streakWrong,
    lastSeenAt: new Date().toISOString(),
  };
}

// --- Difficulty tiers ---

// Seeded problems only use three difficulty_level values (see
// DIFFICULTY_LEVELS in agents/app/pre_generation/problem_quality.py).
export type DifficultyBand = "easy" | "medium" | "hard";
export const DIFFICULTY_TIER_LEVELS: Record<DifficultyBand, number> = {
  easy: 3,
  medium: 5,
  hard: 8,
};

/** Maps a skill level (1-10) to the difficulty band it should be served. */
export function levelToBand(level: number): DifficultyBand {
  if (level <= 3) return "easy";
  if (level <= 6) return "medium";
  return "hard";
}

export function isDifficultyBand(value: unknown): value is DifficultyBand {
  return value === "easy" || value === "medium" || value === "hard";
}

const BAND_RANK: Record<DifficultyBand, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Minimum question difficulty for a candidate's overall level. Subtopic
 * levels reset to 1 on every overall level-up; the floor keeps that reset from
 * sending them back to easy questions.
 */
export function difficultyFloor(overallLevel: number): DifficultyBand {
  if (overallLevel >= 3) return "hard";
  if (overallLevel === 2) return "medium";
  return "easy";
}

/** The band actually served: the subtopic's own band, raised to the floor. */
export function effectiveBand(level: number, overallLevel: number): DifficultyBand {
  const own = levelToBand(level);
  const floor = difficultyFloor(overallLevel);
  return BAND_RANK[own] >= BAND_RANK[floor] ? own : floor;
}

export function bandBelow(band: DifficultyBand): DifficultyBand {
  return band === "hard" ? "medium" : "easy";
}

export function bandAbove(band: DifficultyBand): DifficultyBand {
  return band === "easy" ? "medium" : "hard";
}

// --- Section & overall level ---

export const MAX_LEVEL = 10;

export type Proficiency = "beginner" | "developing" | "proficient" | "advanced";

export function levelToProficiency(level: number): Proficiency {
  if (level <= 3) return "beginner";
  if (level <= 5) return "developing";
  if (level <= 7) return "proficient";
  return "advanced";
}

/**
 * Average level over subtopics the candidate has actually practiced, rounded
 * to one decimal. Used for a section's level. Untouched subtopics sit at their
 * starting level and are excluded so they don't drag the average down. Null
 * until anything is practiced.
 */
export function averagePracticedLevel(
  skills: { level: number; totalAttempts: number }[]
): number | null {
  const practiced = skills.filter((s) => s.totalAttempts > 0);
  if (practiced.length === 0) return null;
  const avg = practiced.reduce((sum, s) => sum + s.level, 0) / practiced.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Share of a section's subtopics that must be practiced before its level can
 * count toward an overall level-up. Without it, maxing one subtopic per
 * section would be enough.
 */
export const SECTION_COVERAGE_REQUIRED = 0.5;

export type SectionLevel<S extends string = string> = {
  section: S;
  /** Average level of practiced subtopics; null = not practiced yet. */
  level: number | null;
  practicedSubtopics: number;
  totalSubtopics: number;
  /** Practiced subtopics needed for this section to count as maxed. */
  requiredSubtopics: number;
  /** Level 10 with enough coverage: counts toward the overall level-up. */
  maxed: boolean;
};

export function getSectionLevels<S extends string>(
  skills: { sectionCategory: string; level: number; totalAttempts: number }[],
  sections: readonly S[],
  /** Subtopics in each section's curriculum. */
  subtopicCounts: Partial<Record<S, number>>
): SectionLevel<S>[] {
  return sections.map((section) => {
    const sectionSkills = skills.filter((s) => s.sectionCategory === section);
    const level = averagePracticedLevel(sectionSkills);
    const practicedSubtopics = sectionSkills.filter((s) => s.totalAttempts > 0).length;
    const totalSubtopics = Math.max(subtopicCounts[section] ?? 0, practicedSubtopics);
    const requiredSubtopics = Math.max(1, Math.ceil(totalSubtopics * SECTION_COVERAGE_REQUIRED));
    return {
      section,
      level,
      practicedSubtopics,
      totalSubtopics,
      requiredSubtopics,
      maxed: level !== null && level >= MAX_LEVEL && practicedSubtopics >= requiredSubtopics,
    };
  });
}

/**
 * The overall level goes up once every one of the candidate's sections
 * (AUD, FAR, REG + their discipline) is maxed: at least half its subtopics
 * practiced, and every practiced subtopic at level 10.
 */
export function isReadyForOverallLevelUp(sectionLevels: { maxed: boolean }[]): boolean {
  return sectionLevels.length > 0 && sectionLevels.every((s) => s.maxed);
}

// --- Quest Composition ---

export type BucketAssignment = {
  subtopicId: string;
  bucket: QuestBucket;
  targetDifficulty: number;
};

export function composeDailyQuestBuckets(
  skills: SubsectionSkill[],
  /** Per-subtopic level offsets that affect bucket ordering only, not difficulty. */
  sortAdjust: Map<string, number> = new Map(),
  /** Raises the minimum difficulty served (see difficultyFloor). */
  overallLevel: number = 1
): BucketAssignment[] {
  if (skills.length === 0) return [];

  // Sort weakest first. Ties prefer subtopics the candidate has actually
  // practiced, so untouched level-1 subtopics don't crowd out real weak spots.
  const sortKey = (s: SubsectionSkill) => s.level + (sortAdjust.get(s.subtopicId) ?? 0);
  const sorted = [...skills].sort(
    (a, b) =>
      sortKey(a) - sortKey(b) ||
      Number(b.totalAttempts > 0) - Number(a.totalAttempts > 0)
  );

  const total = sorted.length;
  const weakCount = Math.max(1, Math.round(total * 0.6));
  const midCount = Math.max(1, Math.round(total * 0.3));
  // stretch gets the rest

  return sorted.map((skill, i): BucketAssignment => {
    let bucket: QuestBucket;
    let targetDifficulty: number;

    // Weak and mid buckets differ in which subtopics they pick, not in
    // difficulty: both serve the subtopic's own tier. Stretch serves the next
    // tier up — a +1 level bump usually stays inside the same 3/5/8 tier.
    const band = effectiveBand(skill.level, overallLevel);
    if (i < weakCount) {
      bucket = "weak";
      targetDifficulty = DIFFICULTY_TIER_LEVELS[band];
    } else if (i < weakCount + midCount) {
      bucket = "mid";
      targetDifficulty = DIFFICULTY_TIER_LEVELS[band];
    } else {
      bucket = "stretch";
      targetDifficulty = DIFFICULTY_TIER_LEVELS[bandAbove(band)];
    }

    return { subtopicId: skill.subtopicId, bucket, targetDifficulty };
  });
}

/**
 * Given bucket assignments and a target of 20 questions,
 * returns how many questions to pull from each subtopic.
 */
export function distributeQuestQuestions(
  buckets: BucketAssignment[],
  totalQuestions: number = 20
): (BucketAssignment & { questionCount: number })[] {
  const weakBuckets = buckets.filter((b) => b.bucket === "weak");
  const midBuckets = buckets.filter((b) => b.bucket === "mid");
  const stretchBuckets = buckets.filter((b) => b.bucket === "stretch");

  let weakTotal = Math.round(totalQuestions * 0.6); // 12
  let midTotal = Math.round(totalQuestions * 0.3); // 6
  let stretchTotal = totalQuestions - weakTotal - midTotal; // 2

  // With few eligible subtopics some buckets are empty — roll their share
  // into the nearest non-empty bucket so the quest still has its full length.
  if (stretchBuckets.length === 0) {
    midTotal += stretchTotal;
    stretchTotal = 0;
  }
  if (midBuckets.length === 0) {
    weakTotal += midTotal;
    midTotal = 0;
  }

  const distribute = (
    items: BucketAssignment[],
    count: number
  ): (BucketAssignment & { questionCount: number })[] => {
    if (items.length === 0) return [];
    const base = Math.floor(count / items.length);
    let remainder = count - base * items.length;
    return items.map((item) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder--;
      return { ...item, questionCount: base + extra };
    });
  };

  return [
    ...distribute(weakBuckets, weakTotal),
    ...distribute(midBuckets, midTotal),
    ...distribute(stretchBuckets, stretchTotal),
  ];
}

// --- Helpers ---

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
