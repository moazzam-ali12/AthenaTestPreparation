// Validation for admin edits. Pure (no server imports) so it is unit-tested
// and could be reused client-side.
import { z } from "zod";
import {
  tbsAnswerKeySchema,
  tbsExhibitSchema,
  tbsFieldSchema,
  type TbsAnswerKey,
  type TbsField,
} from "@/lib/tbs/schema";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const PROBLEM_STATUSES = ["draft", "approved", "rejected", "archived"] as const;
export const TBS_STATUSES = ["draft", "approved", "rejected"] as const;
export const ADMIN_SECTIONS = ["aud", "far", "reg", "bar", "isc", "tcp"] as const;
/** Sources the question bank manages (custom = user-generated, not listed). */
export const BANK_SOURCES = ["cpa", "full_cpa", "practice", "onboarding"] as const;

export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

const uuid = z.string().uuid();

// ── Questions ──────────────────────────────────────────────────────────────
export const problemPatchSchema = z
  .object({
    question_text: z.string().trim().min(10, "Stem is too short").max(5000),
    options: z.array(z.string().trim().min(1, "Options cannot be empty").max(1000)).min(2).max(6),
    correct_option: z.number().int().min(0),
    explanation: z.string().trim().min(1, "Explanation is required").max(10000),
    difficulty: z.enum(DIFFICULTIES),
    subtopic_id: uuid,
    status: z.enum(PROBLEM_STATUSES),
  })
  .partial()
  .strict();

export type ProblemPatch = z.infer<typeof problemPatchSchema>;

export type ProblemEditable = {
  question_text: string;
  options: string[];
  correct_option: number;
  explanation: string;
  difficulty: string;
  subtopic_id: string | null;
  status: string;
};

/**
 * Validates a patch against the row it will produce. Returns error messages
 * (empty = valid). The answer must be one of the options, options must be
 * distinct, and an approved question must be complete.
 */
export function validateProblem(current: ProblemEditable, patch: ProblemPatch): string[] {
  const next = { ...current, ...patch };
  const errors: string[] = [];
  const options = Array.isArray(next.options) ? next.options : [];
  if (options.length < 2) errors.push("A question needs at least 2 options");
  const normalized = options.map((o) => String(o).trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) errors.push("Options must be distinct");
  if (
    !Number.isInteger(next.correct_option) ||
    next.correct_option < 0 ||
    next.correct_option >= options.length
  ) {
    errors.push("The correct answer must be one of the options");
  }
  if (!DIFFICULTIES.includes(next.difficulty as (typeof DIFFICULTIES)[number])) {
    errors.push("Difficulty must be easy, medium or hard");
  }
  if (next.status === "approved") {
    if (!next.question_text?.trim()) errors.push("An approved question needs a stem");
    if (!next.explanation?.trim()) errors.push("An approved question needs an explanation");
  }
  return errors;
}

// ── TBS ────────────────────────────────────────────────────────────────────
export const tbsPatchSchema = z
  .object({
    title: z.string().trim().min(3).max(300),
    difficulty: z.enum(DIFFICULTIES),
    instructions: z.string().trim().min(1).max(20000),
    explanation: z.string().max(20000),
    est_minutes: z.number().int().min(1).max(180),
    subtopic_id: uuid.nullable(),
    exhibits: z.array(tbsExhibitSchema).max(20),
    fields: z.array(tbsFieldSchema).min(1).max(60),
    answer_key: tbsAnswerKeySchema,
    status: z.enum(TBS_STATUSES),
  })
  .partial()
  .strict();

export type TbsPatch = z.infer<typeof tbsPatchSchema>;

/** Cross-checks fields against their answer key. Returns error messages (empty = valid). */
export function validateTbsKey(fields: TbsField[], key: TbsAnswerKey | null): string[] {
  const errors: string[] = [];
  const ids = fields.map((f) => f.id);
  if (new Set(ids).size !== ids.length) errors.push("Field ids must be unique");
  if (!key) return [...errors, "Answer key is missing or invalid"];

  for (const field of fields) {
    const k = key[field.id];
    if (!k) {
      errors.push(`Field "${field.id}" has no answer`);
      continue;
    }
    if (k.type !== field.type) {
      errors.push(`Field "${field.id}" answer type ${k.type} does not match field type ${field.type}`);
      continue;
    }
    if (field.type === "option_list" && k.type === "option_list" && !field.options.includes(k.value)) {
      errors.push(`Field "${field.id}" answer is not one of its options`);
    }
    if (field.type === "journal_entry" && k.type === "journal_entry") {
      const unknown = k.lines.filter((l) => !field.accounts.includes(l.account));
      if (unknown.length) errors.push(`Field "${field.id}" answer uses accounts not in its list`);
      const sum = (side: "debit" | "credit") =>
        k.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
      if (Math.abs(sum("debit") - sum("credit")) > 0.005) {
        errors.push(`Field "${field.id}" journal entry does not balance`);
      }
    }
  }
  const extra = Object.keys(key).filter((id) => !ids.includes(id));
  if (extra.length) errors.push(`Answer key has entries for unknown fields: ${extra.join(", ")}`);
  return errors;
}

// ── Users ──────────────────────────────────────────────────────────────────
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const userActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend_trial"), days: z.number().int().min(1).max(90) }),
  z.object({ action: z.literal("clear_lock") }),
  z.object({ action: z.literal("add_streak_freeze"), startDate: isoDate, endDate: isoDate }),
  z.object({ action: z.literal("resend_notification"), kind: z.enum(["welcome", "streak_alert"]) }),
]);

export type UserAction = z.infer<typeof userActionSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** New trial end: N days past the later of now and the current end. */
export function extendedTrialEnd(currentEnd: Date | null, days: number, now: Date = new Date()): Date {
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** First Zod issue as a readable message. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
