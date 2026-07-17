export type CpaSection = "AUD" | "FAR" | "REG" | "BAR" | "ISC" | "TCP";

/**
 * Last-resort `subject` fallback for the CPA-exam `/practice-problems`
 * generator (backend maps it via SUBJECT_LABELS: aud|far|reg|bar|isc|tcp).
 * NOTE: My Learning practice no longer uses this — it now sources problems
 * directly from the stored `problems` table (source='custom'). Retained only
 * as a default for any CPA-flow caller that still needs one.
 */
export const MY_LEARNING_PRACTICE_SUBJECT = "aud";

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
  passed: boolean | null;
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
};

export type CpaExamSubmitResponse = {
  section: CpaSection;
  rawScore: number;
  scaledScore: number;
  passed: boolean;
};

export type CpaExamHistoryResponse = {
  attempts: CpaSectionExamAttempt[];
};
