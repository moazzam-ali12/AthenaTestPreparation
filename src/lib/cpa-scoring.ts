/**
 * CPA scoring: raw-to-scaled conversion.
 *
 * The AICPA does not publish a raw-to-scaled conversion formula (real CPA
 * scoring uses an undisclosed IRT/equating model, and mixes MCQ with
 * Task-Based Simulations this app doesn't support). This is a transparent
 * linear approximation for practice purposes only: scaled score is
 * percentage-correct scaled to 0-99, passing at 75.
 */

import type { CpaSection } from "@/types/cpa-exam";

export const CPA_PASSING_SCORE = 75;

/** Minimum accuracy (0-1) on a subtopic quiz to count as "passed"/"mastered." */
export const SUBTOPIC_PASS_THRESHOLD = 0.7;

/** Scale a raw correct-count to a 0-99 score given the total question count. */
export function scaleScore(rawCorrect: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  const pct = Math.max(0, Math.min(rawCorrect / totalQuestions, 1));
  return Math.round(pct * 99);
}

export function isPassing(scaledScore: number): boolean {
  return scaledScore >= CPA_PASSING_SCORE;
}

export function computeSectionExamScore(
  rawCorrect: number,
  totalQuestions: number
): { scaledScore: number; passed: boolean } {
  const scaledScore = scaleScore(rawCorrect, totalQuestions);
  return { scaledScore, passed: isPassing(scaledScore) };
}

/** Section-agnostic — every CPA section uses the same 0-99 scale, passing at 75. */
export const CPA_SECTIONS: CpaSection[] = ["AUD", "FAR", "REG", "BAR", "ISC", "TCP"];
