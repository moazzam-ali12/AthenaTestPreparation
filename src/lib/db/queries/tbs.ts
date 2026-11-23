import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import type { Json } from "@/types/supabase";
import { isCpaSubject, type CpaSubject } from "@/types/cpa-exam";
import {
  tbsAnswerKeySchema,
  tbsExhibitSchema,
  tbsFieldSchema,
  tbsResponsesSchema,
  type TbsAnswerKey,
  type TbsAttemptState,
  type TbsDifficulty,
  type TbsFieldResult,
  type TbsResponses,
  type TbsTaskPublic,
} from "@/lib/tbs/schema";

const exhibitsSchema = z.array(tbsExhibitSchema);
const fieldsSchema = z.array(tbsFieldSchema);

function toDifficulty(value: string): TbsDifficulty {
  return value === "easy" || value === "hard" ? value : "medium";
}

export type TbsTaskRow = TbsTaskPublic & { section: CpaSubject; isSample: boolean; explanation: string };

const TASK_COLUMNS =
  "id, section, subtopic_id, title, difficulty, instructions, exhibits, fields, explanation, est_minutes, is_sample";

type RawTask = {
  id: string;
  section: string;
  subtopic_id: string | null;
  title: string;
  difficulty: string;
  instructions: string;
  exhibits: Json;
  fields: Json;
  explanation: string;
  est_minutes: number;
  is_sample: boolean;
};

function mapTask(row: RawTask): TbsTaskRow | null {
  const exhibits = exhibitsSchema.safeParse(row.exhibits);
  const fields = fieldsSchema.safeParse(row.fields);
  if (!exhibits.success || !fields.success || !isCpaSubject(row.section)) {
    console.error(`tbs_tasks ${row.id} has an invalid shape; skipping`);
    return null;
  }
  return {
    id: row.id,
    section: row.section,
    subtopicId: row.subtopic_id,
    title: row.title,
    difficulty: toDifficulty(row.difficulty),
    instructions: row.instructions,
    exhibits: exhibits.data,
    fields: fields.data,
    estMinutes: row.est_minutes,
    explanation: row.explanation,
    isSample: row.is_sample,
  };
}

/** Strips server-only columns. The only shape ever sent before submit. */
export function toPublicTask(task: TbsTaskRow): TbsTaskPublic {
  return {
    id: task.id,
    section: task.section,
    subtopicId: task.subtopicId,
    title: task.title,
    difficulty: task.difficulty,
    instructions: task.instructions,
    exhibits: task.exhibits,
    fields: task.fields,
    estMinutes: task.estMinutes,
  };
}

/** Approved tasks for a section, samples first, with subtopic names. */
export async function listApprovedTbs(section: CpaSubject) {
  const { data, error } = await supabase
    .from("tbs_tasks")
    .select("id, title, difficulty, est_minutes, is_sample, subtopics(name)")
    .eq("section", section)
    .eq("status", "approved")
    .order("is_sample", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`tbs_tasks list failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    difficulty: toDifficulty(r.difficulty),
    estMinutes: r.est_minutes,
    isSample: r.is_sample,
    subtopicName: r.subtopics?.name ?? null,
  }));
}

export async function getApprovedTbs(id: string): Promise<TbsTaskRow | null> {
  const { data, error } = await supabase
    .from("tbs_tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw new Error(`tbs_tasks read failed: ${error.message}`);
  return data ? mapTask(data) : null;
}

export async function getTbsAnswerKey(tbsId: string): Promise<TbsAnswerKey | null> {
  const { data, error } = await supabase
    .from("tbs_answer_keys")
    .select("answers")
    .eq("tbs_id", tbsId)
    .maybeSingle();
  if (error) throw new Error(`tbs_answer_keys read failed: ${error.message}`);
  const parsed = tbsAnswerKeySchema.safeParse(data?.answers);
  return parsed.success ? parsed.data : null;
}

type RawAttempt = {
  id: string;
  responses: Json;
  started_at: string;
  time_spent_seconds: number;
};

function mapAttempt(row: RawAttempt): TbsAttemptState {
  const responses = tbsResponsesSchema.safeParse(row.responses);
  return {
    id: row.id,
    responses: responses.success ? responses.data : {},
    startedAt: row.started_at,
    timeSpentSeconds: row.time_spent_seconds,
  };
}

const ATTEMPT_COLUMNS = "id, responses, started_at, time_spent_seconds";

export async function getInProgressAttempt(userId: string, tbsId: string): Promise<TbsAttemptState | null> {
  const { data, error } = await supabase
    .from("tbs_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("user_id", userId)
    .eq("tbs_id", tbsId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (error) throw new Error(`tbs_attempts read failed: ${error.message}`);
  return data ? mapAttempt(data) : null;
}

/** Resumes the in-progress attempt, or starts one (race-safe via the partial unique index). */
export async function getOrCreateInProgressAttempt(userId: string, tbsId: string): Promise<TbsAttemptState> {
  const existing = await getInProgressAttempt(userId, tbsId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("tbs_attempts")
    .insert({ user_id: userId, tbs_id: tbsId })
    .select(ATTEMPT_COLUMNS)
    .single();
  if (data) return mapAttempt(data);
  // 23505: a parallel request created it first.
  if (error?.code === "23505") {
    const raced = await getInProgressAttempt(userId, tbsId);
    if (raced) return raced;
  }
  throw new Error(`tbs_attempts insert failed: ${error?.message ?? "unknown"}`);
}

export async function saveAttemptResponses(
  attemptId: string,
  responses: TbsResponses,
  timeSpentSeconds: number
) {
  const { error } = await supabase
    .from("tbs_attempts")
    .update({ responses, time_spent_seconds: timeSpentSeconds, updated_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("status", "in_progress");
  if (error) throw new Error(`tbs_attempts update failed: ${error.message}`);
}

/** Marks the attempt submitted. Returns false if it was already submitted (double click). */
export async function completeAttempt(
  attemptId: string,
  result: {
    responses: TbsResponses;
    timeSpentSeconds: number;
    score: number;
    maxScore: number;
    fieldResults: TbsFieldResult[];
  }
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("tbs_attempts")
    .update({
      responses: result.responses,
      time_spent_seconds: result.timeSpentSeconds,
      score: result.score,
      max_score: result.maxScore,
      field_results: result.fieldResults,
      status: "submitted",
      submitted_at: now,
      updated_at: now,
    })
    .eq("id", attemptId)
    .eq("status", "in_progress")
    .select("id");
  if (error) throw new Error(`tbs_attempts submit failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export type TbsUserStat = { status: "in_progress" | "submitted"; bestPercent: number | null };

/** Per-task status and best score for the list view. */
export async function getUserTbsStats(userId: string, tbsIds: string[]): Promise<Map<string, TbsUserStat>> {
  const stats = new Map<string, TbsUserStat>();
  if (tbsIds.length === 0) return stats;
  const { data, error } = await supabase
    .from("tbs_attempts")
    .select("tbs_id, status, score, max_score")
    .eq("user_id", userId)
    .in("tbs_id", tbsIds);
  if (error) throw new Error(`tbs_attempts read failed: ${error.message}`);

  for (const r of data ?? []) {
    const prev = stats.get(r.tbs_id);
    const percent =
      r.status === "submitted" && r.max_score ? Math.round((Number(r.score ?? 0) / Number(r.max_score)) * 100) : null;
    const submitted = r.status === "submitted" || prev?.status === "submitted";
    const best =
      percent === null ? (prev?.bestPercent ?? null) : Math.max(percent, prev?.bestPercent ?? 0);
    stats.set(r.tbs_id, { status: submitted ? "submitted" : "in_progress", bestPercent: best });
  }
  return stats;
}

export type TbsSectionProgress = { section: CpaSubject; completed: number; averagePercent: number };

/** Basic progress: submitted attempts and average score per section. */
export async function getTbsProgress(userId: string): Promise<TbsSectionProgress[]> {
  const { data, error } = await supabase
    .from("tbs_attempts")
    .select("score, max_score, tbs_tasks!inner(section)")
    .eq("user_id", userId)
    .eq("status", "submitted");
  if (error) throw new Error(`tbs_attempts progress failed: ${error.message}`);

  const bySection = new Map<CpaSubject, { completed: number; percentSum: number }>();
  for (const r of data ?? []) {
    const section = r.tbs_tasks.section;
    if (!isCpaSubject(section) || !r.max_score) continue;
    const entry = bySection.get(section) ?? { completed: 0, percentSum: 0 };
    entry.completed += 1;
    entry.percentSum += (Number(r.score ?? 0) / Number(r.max_score)) * 100;
    bySection.set(section, entry);
  }
  return [...bySection].map(([section, e]) => ({
    section,
    completed: e.completed,
    averagePercent: Math.round(e.percentSum / e.completed),
  }));
}
