import { supabase } from "@/lib/supabase/client";
import type {
  CpaSection,
  CpaSectionExam,
  CpaSectionExamAttempt,
  CpaSectionExamProblem,
  CpaSectionExamAnswer,
  CpaSectionStatusEntry,
} from "@/types/cpa-exam";

const db = supabase as any;

// ── Tests ──

export async function getActiveTestsForSection(
  section: CpaSection
): Promise<CpaSectionExam[]> {
  const { data } = await db
    .from("cpa_section_exams")
    .select("*")
    .eq("section", section)
    .eq("status", "active")
    .order("test_number");

  return (data ?? []).map(mapTest);
}

export async function getTestById(testId: string): Promise<CpaSectionExam | null> {
  const { data } = await db
    .from("cpa_section_exams")
    .select("*")
    .eq("id", testId)
    .maybeSingle();

  return data ? mapTest(data) : null;
}

// ── Attempts ──

export async function getLastCompletedAttempt(
  userId: string,
  section: CpaSection
): Promise<CpaSectionExamAttempt | null> {
  const { data } = await db
    .from("cpa_section_exam_attempts")
    .select("*")
    .eq("user_id", userId)
    .eq("section", section)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapAttempt(data) : null;
}

export async function getInProgressAttempt(
  userId: string,
  section: CpaSection
): Promise<CpaSectionExamAttempt | null> {
  const { data } = await db
    .from("cpa_section_exam_attempts")
    .select("*")
    .eq("user_id", userId)
    .eq("section", section)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapAttempt(data) : null;
}

export async function getAttemptById(
  attemptId: string
): Promise<CpaSectionExamAttempt | null> {
  const { data } = await db
    .from("cpa_section_exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();

  return data ? mapAttempt(data) : null;
}

export async function getUserAttempts(
  userId: string,
  section?: CpaSection
): Promise<CpaSectionExamAttempt[]> {
  let query = db
    .from("cpa_section_exam_attempts")
    .select("*")
    .eq("user_id", userId);

  if (section) {
    query = query.eq("section", section);
  }

  const { data } = await query.order("created_at", { ascending: false });

  return (data ?? []).map(mapAttempt);
}

export async function createAttempt(
  userId: string,
  testId: string,
  section: CpaSection
): Promise<CpaSectionExamAttempt> {
  const { data, error } = await db
    .from("cpa_section_exam_attempts")
    .insert({
      user_id: userId,
      test_id: testId,
      section,
      status: "in_progress",
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create attempt");
  return mapAttempt(data);
}

export async function updateAttemptPosition(
  attemptId: string,
  position: {
    currentModule: number;
    currentQuestion: number;
  }
) {
  await db
    .from("cpa_section_exam_attempts")
    .update({
      current_module: position.currentModule,
      current_question: position.currentQuestion,
    })
    .eq("id", attemptId);
}

export async function completeAttempt(
  attemptId: string,
  scores: {
    rawScore: number;
    scaledScore: number;
    totalTimeSeconds: number;
  }
) {
  const { error } = await db
    .from("cpa_section_exam_attempts")
    .update({
      status: "completed",
      raw_score: scores.rawScore,
      scaled_score: scores.scaledScore,
      total_time_seconds: scores.totalTimeSeconds,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId);

  if (error) throw new Error(error.message);
}

// ── Test problems ──

export async function getTestProblems(
  testId: string
): Promise<CpaSectionExamProblem[]> {
  const { data } = await db
    .from("cpa_section_exam_problems")
    .select(
      `
      id,
      problem_id,
      module,
      order_index,
      problems!inner (
        question_text,
        options,
        correct_option,
        explanation,
        solution_steps,
        hint,
        detailed_hint,
        subtopic_id,
        difficulty_level,
        difficulty
      )
    `
    )
    .eq("test_id", testId)
    .order("module")
    .order("order_index");

  return (data ?? []).map((row: any) => ({
    id: row.id,
    problemId: row.problem_id,
    module: row.module,
    orderIndex: row.order_index,
    questionText: row.problems.question_text,
    options: row.problems.options,
    correctOption: row.problems.correct_option,
    explanation: row.problems.explanation,
    solutionSteps: row.problems.solution_steps ?? [],
    hint: row.problems.hint ?? "",
    detailedHint: row.problems.detailed_hint,
    subtopicId: row.problems.subtopic_id,
    difficultyLevel: row.problems.difficulty_level,
    difficulty: row.problems.difficulty,
  }));
}

// ── Answers ──

export async function createAnswerRows(
  attemptId: string,
  problems: CpaSectionExamProblem[]
) {
  const rows = problems.map((p) => ({
    attempt_id: attemptId,
    problem_id: p.problemId,
    module: p.module,
    order_index: p.orderIndex,
  }));

  const { error } = await db.from("cpa_section_exam_answers").insert(rows);
  if (error) throw new Error(error.message);
}

export async function getAttemptAnswers(
  attemptId: string
): Promise<CpaSectionExamAnswer[]> {
  const { data } = await db
    .from("cpa_section_exam_answers")
    .select("*")
    .eq("attempt_id", attemptId)
    .order("module")
    .order("order_index");

  return (data ?? []).map(mapAnswer);
}

export async function upsertAnswer(
  attemptId: string,
  answer: {
    problemId: string;
    module: number;
    orderIndex: number;
    selectedOption: number;
    isCorrect: boolean;
    responseTimeMs?: number;
  }
) {
  const { error } = await db
    .from("cpa_section_exam_answers")
    .update({
      selected_option: answer.selectedOption,
      is_correct: answer.isCorrect,
      response_time_ms: answer.responseTimeMs ?? null,
      answered_at: new Date().toISOString(),
    })
    .eq("attempt_id", attemptId)
    .eq("module", answer.module)
    .eq("order_index", answer.orderIndex);

  if (error) throw new Error(error.message);
}

// ── Section progress (pass/fail tracking) ──

export async function getSectionProgress(
  userId: string,
  section: CpaSection
): Promise<CpaSectionStatusEntry | null> {
  const { data } = await db
    .from("user_cpa_section_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("section", section)
    .maybeSingle();

  return data ? mapProgress(data) : null;
}

export async function getAllSectionProgress(
  userId: string
): Promise<CpaSectionStatusEntry[]> {
  const { data } = await db
    .from("user_cpa_section_progress")
    .select("*")
    .eq("user_id", userId);

  return (data ?? []).map(mapProgress);
}

export async function upsertSectionProgressAfterAttempt(
  userId: string,
  section: CpaSection,
  attemptScaledScore: number,
  attemptPassed: boolean
): Promise<CpaSectionStatusEntry> {
  const existing = await getSectionProgress(userId, section);

  const bestScaledScore =
    existing?.bestScaledScore != null
      ? Math.max(existing.bestScaledScore, attemptScaledScore)
      : attemptScaledScore;
  const passed = existing?.passed || attemptPassed;
  const passedAt = existing?.passed
    ? existing.passedAt
    : attemptPassed
      ? new Date().toISOString()
      : (existing?.passedAt ?? null);
  const attemptsCount = (existing?.attemptsCount ?? 0) + 1;
  const lastAttemptAt = new Date().toISOString();

  const { data, error } = await db
    .from("user_cpa_section_progress")
    .upsert(
      {
        user_id: userId,
        section,
        best_scaled_score: bestScaledScore,
        passed,
        passed_at: passedAt,
        attempts_count: attemptsCount,
        last_attempt_at: lastAttemptAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,section" }
    )
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to update section progress");
  return mapProgress(data);
}

// ── Mappers ──

function mapTest(row: any): CpaSectionExam {
  return {
    id: row.id,
    section: row.section as CpaSection,
    testNumber: row.test_number,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapAttempt(row: any): CpaSectionExamAttempt {
  return {
    id: row.id,
    userId: row.user_id,
    testId: row.test_id,
    section: row.section as CpaSection,
    status: row.status,
    rawScore: row.raw_score,
    scaledScore: row.scaled_score,
    passed: row.passed,
    totalTimeSeconds: row.total_time_seconds ?? 0,
    currentModule: row.current_module ?? 1,
    currentQuestion: row.current_question ?? 0,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapAnswer(row: any): CpaSectionExamAnswer {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    problemId: row.problem_id,
    module: row.module,
    orderIndex: row.order_index,
    selectedOption: row.selected_option,
    isCorrect: row.is_correct,
    responseTimeMs: row.response_time_ms,
    answeredAt: row.answered_at,
  };
}

function mapProgress(row: any): CpaSectionStatusEntry {
  return {
    section: row.section as CpaSection,
    bestScaledScore: row.best_scaled_score,
    passed: row.passed,
    passedAt: row.passed_at,
    attemptsCount: row.attempts_count ?? 0,
    lastAttemptAt: row.last_attempt_at,
  };
}
