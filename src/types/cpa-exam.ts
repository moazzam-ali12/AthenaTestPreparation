export type CpaSection = "AUD" | "FAR" | "REG" | "BAR" | "ISC" | "TCP";

/**
 * Last-resort `subject` fallback for the CPA-exam `/practice-problems`
 * generator (backend maps it via SUBJECT_LABELS: aud|far|reg|bar|isc|tcp).
 * NOTE: My Learning practice no longer uses this — it now sources problems
 * directly from the stored `problems` table (source='custom'). Retained only
 * as a default for any CPA-flow caller that still needs one.
 */
export const MY_LEARNING_PRACTICE_SUBJECT = "aud";

/** Lowercase section code, as stored in `topics.subject`. */
export type CpaSubject = Lowercase<CpaSection>;

export function isCpaSubject(value: unknown): value is CpaSubject {
  return (
    typeof value === "string" &&
    ["aud", "far", "reg", "bar", "isc", "tcp"].includes(value)
  );
}

export const CPA_CORE_SECTIONS: CpaSection[] = ["AUD", "FAR", "REG"];
export const CPA_DISCIPLINE_SECTIONS: CpaSection[] = ["BAR", "ISC", "TCP"];

export type CpaSectionExamStatus = "draft" | "active" | "retired";
export type CpaSectionExamAttemptStatus = "in_progress" | "completed" | "abandoned";

/**
 * Practice-exam question count/time limit per section. This app only supports
 * MCQ-style problems, so these are MCQ-only practice lengths, not a simulation
 * of the full real CPA exam (which mixes MCQ with multi-part Task-Based
 * Simulations this app doesn't have the question format to support). Treat as
 * a placeholder pending client input on desired practice-exam length.
 */
export const SECTION_QUESTION_COUNT = 50;
export const SECTION_TIME_LIMIT_SECONDS = 90 * 60;

export type CpaSectionExam = {
  id: string;
  section: CpaSection;
  testNumber: number;
  name: string;
  status: CpaSectionExamStatus;
  createdAt: string;
};

export type CpaSectionExamAttempt = {
  id: string;
  userId: string;
  testId: string;
  section: CpaSection;
  status: CpaSectionExamAttemptStatus;
  rawScore: number | null;
  scaledScore: number | null;
  /** Null for sample tests — they never pass or fail. */
  passed: boolean | null;
  /** Free-trial sample test: short timer, never affects pass status. */
  isSample: boolean;
  totalTimeSeconds: number;
  currentModule: number;
  currentQuestion: number;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type CpaSectionExamProblem = {
  id: string;
  problemId: string;
  module: number;
  orderIndex: number;
  questionText: string;
  options: string[];
  correctOption: number;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math?: string }[];
  hint: string;
  detailedHint?: string;
  subtopicId: string;
  difficultyLevel: number;
  difficulty: string;
};

export type CpaSectionExamAnswer = {
  id: string;
  attemptId: string;
  problemId: string;
  module: number;
  orderIndex: number;
  selectedOption: number | null;
  isCorrect: boolean | null;
  responseTimeMs: number | null;
  answeredAt: string | null;
};

export type CpaSectionStatusEntry = {
  section: CpaSection;
  bestScaledScore: number | null;
  passed: boolean;
  passedAt: string | null;
  attemptsCount: number;
  lastAttemptAt: string | null;
};

export type CpaExamStatusResponse = {
  section: CpaSection;
  tests: CpaSectionExam[];
  progress: CpaSectionStatusEntry | null;
  canStartNewAttempt: boolean;
  currentAttempt: CpaSectionExamAttempt | null;
};

export type CpaExamStartResponse = {
  attemptId: string;
  test: CpaSectionExam;
  problems: CpaSectionExamProblem[];
  answers: CpaSectionExamAnswer[];
  isSample: boolean;
  /** Time limit for this attempt; the client timer reads this. */
  durationMinutes: number;
};

export type CpaExamSubmitResponse = {
  section: CpaSection;
  rawScore: number;
  scaledScore: number;
  /** Always false for sample tests (they don't pass/fail). */
  passed: boolean;
  isSample: boolean;
  /** New overall level if this exam completed every section at level 10. */
  overallLevelUp?: number | null;
};

/** GET /api/practice-exam/attempts/[id] — loads one attempt by ID (refresh-safe). */
export type CpaExamAttemptResponse = {
  attempt: CpaSectionExamAttempt;
  test: CpaSectionExam;
  /** Answer keys/explanations are stripped while the attempt is in progress. */
  problems: CpaSectionExamProblem[];
  /** `isCorrect` is null while the attempt is in progress. */
  answers: CpaSectionExamAnswer[];
  isSample: boolean;
  durationMinutes: number;
  startedAt: string;
  submittedAt: string | null;
  /** Seconds since `startedAt`, capped at the time limit (drives the resumed timer). */
  elapsedSeconds: number;
  scaledScore: number | null;
  rawScore: number | null;
  total: number;
  /** Null for sample tests and unfinished attempts. */
  passed: boolean | null;
};

/** One question of a submitted attempt, in exam order (GET /api/practice-exam/attempts/[id]/review). */
export type CpaExamReviewQuestion = {
  id: string;
  number: number;
  stem: string;
  options: string[];
  /** Null if the question was skipped. */
  userAnswer: number | null;
  correctAnswer: number;
  isCorrect: boolean;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math?: string }[];
  subtopicName: string | null;
  difficulty: string;
};

export type CpaExamReviewResponse = {
  attemptId: string;
  questions: CpaExamReviewQuestion[];
};

/** 403 body when a review is requested before the attempt is submitted. */
export const ATTEMPT_NOT_SUBMITTED = "ATTEMPT_NOT_SUBMITTED";

export type CpaExamHistoryResponse = {
  attempts: CpaSectionExamAttempt[];
};
