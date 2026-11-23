// Task-Based Simulation (TBS) shapes. Zod schemas are the source of truth:
// they validate jsonb read from the DB and request bodies, and the TS types
// are inferred from them. Client-safe (no server imports).
import { z } from "zod";

// ── Exhibits ──
const cell = z.union([z.string(), z.number()]);

export const tbsExhibitSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["text", "table"]),
  /** Markdown body (memos, emails, notes). Tables may also carry a caption here. */
  body: z.string().nullish(),
  table: z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.array(cell)),
    })
    .nullish(),
});

// ── Public field definitions (never contain answers) ──
const fieldBase = {
  id: z.string().min(1),
  label: z.string().min(1),
  points: z.number().positive(),
};

export const tbsFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...fieldBase, type: z.literal("numeric"), unit: z.string().nullish() }),
  z.object({ ...fieldBase, type: z.literal("option_list"), options: z.array(z.string()).min(2) }),
  z.object({
    ...fieldBase,
    type: z.literal("journal_entry"),
    /** Chart of accounts the user picks from. */
    accounts: z.array(z.string()).min(2),
  }),
]);

// ── Responses (what the client autosaves / submits) ──
const amount = z.number().finite().nullable();

export const jeLineSchema = z.object({
  account: z.string().max(200),
  debit: amount,
  credit: amount,
});

export const tbsResponseValueSchema = z.union([
  z.number().finite(),
  z.string().max(500),
  z.array(jeLineSchema).max(30),
  z.null(),
]);

export const tbsResponsesSchema = z.record(z.string().max(100), tbsResponseValueSchema);

// ── Answer keys (server only; shipped to the client only after submit) ──
export const tbsFieldKeySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("numeric"),
    value: z.number().finite(),
    /** Allowed absolute difference after rounding to whole units (default 0). */
    tolerance: z.number().nonnegative().optional(),
  }),
  z.object({ type: z.literal("option_list"), value: z.string() }),
  z.object({
    type: z.literal("journal_entry"),
    lines: z
      .array(
        z.object({
          account: z.string(),
          side: z.enum(["debit", "credit"]),
          amount: z.number().positive(),
        })
      )
      .min(2),
  }),
]);

export const tbsAnswerKeySchema = z.record(z.string(), tbsFieldKeySchema);

export type TbsExhibit = z.infer<typeof tbsExhibitSchema>;
export type TbsField = z.infer<typeof tbsFieldSchema>;
export type JeLine = z.infer<typeof jeLineSchema>;
export type TbsResponseValue = z.infer<typeof tbsResponseValueSchema>;
export type TbsResponses = z.infer<typeof tbsResponsesSchema>;
export type TbsFieldKey = z.infer<typeof tbsFieldKeySchema>;
export type TbsAnswerKey = z.infer<typeof tbsAnswerKeySchema>;

export type TbsDifficulty = "easy" | "medium" | "hard";

/** Everything the client may see before submitting. */
export type TbsTaskPublic = {
  id: string;
  section: string;
  subtopicId: string | null;
  title: string;
  difficulty: TbsDifficulty;
  instructions: string;
  exhibits: TbsExhibit[];
  fields: TbsField[];
  estMinutes: number;
};

export type TbsFieldResult = {
  fieldId: string;
  earned: number;
  possible: number;
  correct: boolean;
  /** Human-readable correct answer (revealed after submit only). */
  expected: string;
  note?: string;
};

export type TbsAttemptState = {
  id: string;
  responses: TbsResponses;
  startedAt: string;
  timeSpentSeconds: number;
};

export type TbsOpenResponse = { task: TbsTaskPublic; attempt: TbsAttemptState };

export type TbsSubmitResponse = {
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  fieldResults: TbsFieldResult[];
  explanation: string;
  xpEarned: number;
  /** New overall level if this submit completed every section at level 10. */
  overallLevelUp: number | null;
};

export type TbsListItem = {
  id: string;
  title: string;
  subtopicName: string | null;
  difficulty: TbsDifficulty;
  estMinutes: number;
  isSample: boolean;
  locked: boolean;
  status: "not_started" | "in_progress" | "submitted";
  bestPercent: number | null;
};

/** A TBS counts as a correct answer for the adaptive engine at this score. */
export const TBS_PASS_PERCENT = 75;
