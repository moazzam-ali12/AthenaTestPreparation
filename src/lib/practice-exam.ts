// Pure practice-exam rules shared by the API routes (no server imports, unit-testable).
import {
  ATTEMPT_NOT_SUBMITTED,
  SECTION_TIME_LIMIT_SECONDS,
  type CpaExamReviewQuestion,
  type CpaExamReviewResponse,
} from "../types/cpa-exam";
import { SAMPLE_TEST_MINUTES } from "./trial";

type AttemptKind = { isSample: boolean };

/** Time limit for an attempt: short for trial sample tests, full otherwise. */
export function examDurationMinutes(attempt: AttemptKind): number {
  return attempt.isSample ? SAMPLE_TEST_MINUTES : SECTION_TIME_LIMIT_SECONDS / 60;
}

/**
 * Records a finished exam in section progress (pass flag, best score, attempt
 * count). Sample tests are skipped: they must never affect pass status or
 * full-exam stats. Returns whether section progress was updated.
 */
export async function applySectionProgress(
  attempt: AttemptKind,
  scaledScore: number,
  passed: boolean,
  upsert: (scaledScore: number, passed: boolean) => Promise<unknown>
): Promise<boolean> {
  if (attempt.isSample) return false;
  await upsert(scaledScore, passed);
  return true;
}

/** Owner check for attempt lookups: anything not owned by `userId` is treated as missing (404). */
export function ownedAttempt<T extends { userId: string }>(attempt: T | null, userId: string): T | null {
  return attempt && attempt.userId === userId ? attempt : null;
}

/** Wall-clock seconds since the attempt started, clamped to [0, time limit]. */
export function attemptElapsedSeconds(startedAt: string, durationMinutes: number, now: number = Date.now()): number {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  const elapsed = Math.floor((now - started) / 1000);
  return Math.min(Math.max(0, elapsed), Math.round(durationMinutes * 60));
}

/** Strips answer keys and worked solutions so an in-progress attempt can't be read ahead. */
export function redactProblem<P extends { correctOption: number; explanation: string; solutionSteps: unknown[]; detailedHint?: string }>(
  problem: P
): P {
  return { ...problem, correctOption: -1, explanation: "", solutionSteps: [], detailedHint: undefined };
}

export type StartOutcome<A, E> =
  | { kind: "resumed"; attempt: A }
  | { kind: "created"; attempt: A }
  | { kind: "limit" }
  | { kind: "error"; error: E };

/**
 * Idempotent exam start. An in-progress attempt is returned as-is (no quota use,
 * no new row). Otherwise `prepare` validates the exam, the sample quota is consumed
 * only for a sample and only right before a NEW attempt is created.
 */
export async function startOrResumeAttempt<A, P, E>(opts: {
  sample: boolean;
  findInProgress: () => Promise<A | null>;
  prepare: () => Promise<{ ok: true; value: P } | { ok: false; error: E }>;
  consumeSampleQuota: () => Promise<boolean>;
  create: (prepared: P) => Promise<A>;
}): Promise<StartOutcome<A, E>> {
  const existing = await opts.findInProgress();
  if (existing) return { kind: "resumed", attempt: existing };

  const prepared = await opts.prepare();
  if (!prepared.ok) return { kind: "error", error: prepared.error };

  if (opts.sample && !(await opts.consumeSampleQuota())) return { kind: "limit" };
  return { kind: "created", attempt: await opts.create(prepared.value) };
}

type ReviewAttempt = { id: string; userId: string; status: string };
type ReviewAnswer = { problemId: string; module: number; orderIndex: number; selectedOption: number | null };
type ReviewProblem = {
  problemId: string;
  questionText: string;
  options: string[];
  correctOption: number;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math?: string }[];
  subtopicId: string;
  difficulty: string;
};

export type ReviewResult =
  | { status: 404 }
  | { status: 403; code: typeof ATTEMPT_NOT_SUBMITTED }
  | { status: 200; body: CpaExamReviewResponse };

/** Gate for the review endpoint: owner only (404), submitted only (403). The security boundary for answer keys. */
export function reviewAccess(attempt: ReviewAttempt | null, userId: string): ReviewResult | null {
  const owned = ownedAttempt(attempt, userId);
  if (!owned) return { status: 404 };
  if (owned.status !== "completed") return { status: 403, code: ATTEMPT_NOT_SUBMITTED };
  return null;
}

/**
 * Per-question review of a submitted attempt, built from its stored answer rows
 * (which define the question set and order) joined to the problems + answer keys.
 */
export function buildAttemptReview(
  attempt: ReviewAttempt,
  userId: string,
  answers: readonly ReviewAnswer[],
  problems: readonly ReviewProblem[],
  subtopicNames: ReadonlyMap<string, string>
): ReviewResult {
  const denied = reviewAccess(attempt, userId);
  if (denied) return denied;

  const byId = new Map(problems.map((p) => [p.problemId, p]));
  const ordered = [...answers].sort((a, b) => a.module - b.module || a.orderIndex - b.orderIndex);
  const questions: CpaExamReviewQuestion[] = [];
  for (const a of ordered) {
    const p = byId.get(a.problemId);
    if (!p) continue;
    const userAnswer = a.selectedOption ?? null;
    questions.push({
      id: p.problemId,
      number: questions.length + 1,
      stem: p.questionText,
      options: p.options,
      userAnswer,
      correctAnswer: p.correctOption,
      isCorrect: userAnswer !== null && userAnswer === p.correctOption,
      explanation: p.explanation ?? "",
      solutionSteps: p.solutionSteps ?? [],
      subtopicName: subtopicNames.get(p.subtopicId) ?? null,
      difficulty: p.difficulty,
    });
  }
  return { status: 200, body: { attemptId: attempt.id, questions } };
}
