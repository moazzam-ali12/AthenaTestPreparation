import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extendedTrialEnd,
  problemPatchSchema,
  tbsPatchSchema,
  userActionSchema,
  validateProblem,
  validateTbsKey,
  type ProblemEditable,
} from "./validation";
import type { TbsField } from "@/lib/tbs/schema";

const base: ProblemEditable = {
  question_text: "Which of the following is correct?",
  options: ["A", "B", "C", "D"],
  correct_option: 1,
  explanation: "Because.",
  difficulty: "medium",
  subtopic_id: null,
  status: "approved",
};

test("valid problem edit passes", () => {
  assert.deepEqual(validateProblem(base, { correct_option: 3, difficulty: "hard" }), []);
});

test("answer must be one of the options", () => {
  assert.ok(validateProblem(base, { correct_option: 4 }).some((e) => /one of the options/.test(e)));
  // Shrinking options below the current answer index is caught too.
  assert.ok(validateProblem({ ...base, correct_option: 3 }, { options: ["A", "B"] }).length > 0);
});

test("options must be distinct and at least two", () => {
  assert.ok(validateProblem(base, { options: ["A", "a ", "C"] }).some((e) => /distinct/.test(e)));
  assert.equal(problemPatchSchema.safeParse({ options: ["A"] }).success, false);
  assert.equal(problemPatchSchema.safeParse({ options: ["A", ""] }).success, false);
});

test("patch schema rejects unknown fields and bad values", () => {
  assert.equal(problemPatchSchema.safeParse({ source: "custom" }).success, false);
  assert.equal(problemPatchSchema.safeParse({ difficulty: "insane" }).success, false);
  assert.equal(problemPatchSchema.safeParse({ status: "published" }).success, false);
  assert.equal(problemPatchSchema.safeParse({ status: "archived" }).success, true);
});

const fields: TbsField[] = [
  { id: "f1", type: "numeric", label: "Amount", points: 1 },
  { id: "f2", type: "option_list", label: "Pick", points: 1, options: ["Yes", "No"] },
  { id: "f3", type: "journal_entry", label: "JE", points: 2, accounts: ["Cash", "Revenue"] },
];

const goodKey = {
  f1: { type: "numeric" as const, value: 100 },
  f2: { type: "option_list" as const, value: "Yes" },
  f3: {
    type: "journal_entry" as const,
    lines: [
      { account: "Cash", side: "debit" as const, amount: 50 },
      { account: "Revenue", side: "credit" as const, amount: 50 },
    ],
  },
};

test("consistent TBS key passes", () => {
  assert.deepEqual(validateTbsKey(fields, goodKey), []);
});

test("TBS key problems are reported", () => {
  assert.ok(validateTbsKey(fields, null).length > 0);
  assert.ok(validateTbsKey(fields, { ...goodKey, f2: { type: "option_list", value: "Maybe" } }).length > 0);
  assert.ok(
    validateTbsKey(fields, {
      ...goodKey,
      f3: { type: "journal_entry", lines: [{ account: "Cash", side: "debit", amount: 50 }, { account: "Revenue", side: "credit", amount: 40 }] },
    }).some((e) => /balance/.test(e))
  );
  const missing: Record<string, unknown> = { ...goodKey };
  delete missing.f1;
  assert.ok(validateTbsKey(fields, missing as typeof goodKey).some((e) => /f1/.test(e)));
  assert.ok(validateTbsKey(fields, { ...goodKey, f1: { type: "option_list", value: "Yes" } }).length > 0);
  assert.ok(validateTbsKey(fields, { ...goodKey, extra: { type: "numeric", value: 1 } }).length > 0);
});

test("TBS patch schema rejects unknown keys", () => {
  assert.equal(tbsPatchSchema.safeParse({ is_sample: true }).success, false);
  assert.equal(tbsPatchSchema.safeParse({ status: "archived" }).success, false);
});

test("user actions are validated", () => {
  assert.equal(userActionSchema.safeParse({ action: "extend_trial", days: 0 }).success, false);
  assert.equal(userActionSchema.safeParse({ action: "extend_trial", days: 7 }).success, true);
  assert.equal(userActionSchema.safeParse({ action: "add_streak_freeze", startDate: "2026-1-1", endDate: "2026-01-02" }).success, false);
  assert.equal(userActionSchema.safeParse({ action: "delete_user" }).success, false);
});

test("trial extension builds on the later of now and the current end", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(extendedTrialEnd(null, 3, now).getTime(), now.getTime() + 3 * day);
  assert.equal(extendedTrialEnd(new Date(now.getTime() - 5 * day), 3, now).getTime(), now.getTime() + 3 * day);
  const future = new Date(now.getTime() + 2 * day);
  assert.equal(extendedTrialEnd(future, 3, now).getTime(), future.getTime() + 3 * day);
});
