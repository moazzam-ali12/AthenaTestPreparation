import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeJournalEntry, gradeNumeric, gradeOption, gradeTbs } from "./grade";
import { decideTbsOpen } from "./access";
import { toPublicTask, type TbsTaskRow } from "../db/queries/tbs";
import type { JeLine, TbsAnswerKey, TbsField } from "./schema";

const key = [
  { account: "Accounts Receivable", side: "debit", amount: 5000 },
  { account: "Sales Revenue", side: "credit", amount: 4000 },
  { account: "Unearned Revenue", side: "credit", amount: 1000 },
] as const;

const line = (account: string, debit: number | null, credit: number | null): JeLine => ({ account, debit, credit });

test("numeric: exact after rounding to whole dollars, with tolerance", () => {
  assert.equal(gradeNumeric(12500.4, 12500), 1);
  assert.equal(gradeNumeric(12501, 12500), 0);
  assert.equal(gradeNumeric(12502, 12500, 2), 1);
  assert.equal(gradeNumeric(-300, -300), 1, "negatives");
  assert.equal(gradeNumeric(null, 12500), 0);
  assert.equal(gradeNumeric("12500", 12500), 0, "strings are not numbers");
});

test("option list: wrong option scores 0", () => {
  assert.equal(gradeOption("Qualified opinion", "Qualified opinion"), 1);
  assert.equal(gradeOption("Adverse opinion", "Qualified opinion"), 0);
  assert.equal(gradeOption(null, "Qualified opinion"), 0);
});

test("JE: different line order earns full credit (case/space-insensitive accounts)", () => {
  const r = gradeJournalEntry(
    [line("Unearned Revenue", null, 1000), line(" sales revenue ", null, 4000), line("Accounts Receivable", 5000, null)],
    key
  );
  assert.deepEqual(r, { fraction: 1, balanced: true });
});

test("JE: wrong side loses that line", () => {
  const r = gradeJournalEntry(
    [line("Accounts Receivable", 5000, null), line("Sales Revenue", 4000, null), line("Unearned Revenue", null, 1000)],
    key
  );
  assert.equal(r.fraction, 2 / 3);
  assert.equal(r.balanced, false);
});

test("JE: missing line loses credit", () => {
  const r = gradeJournalEntry([line("Accounts Receivable", 5000, null), line("Sales Revenue", null, 4000)], key);
  assert.equal(r.fraction, 2 / 3);
});

test("JE: extra line loses credit", () => {
  const r = gradeJournalEntry(
    [
      line("Accounts Receivable", 5000, null),
      line("Sales Revenue", null, 4000),
      line("Unearned Revenue", null, 1000),
      line("Cash", 100, null),
    ],
    key
  );
  assert.equal(r.fraction, 3 / 4);
});

test("JE: unbalanced entry is flagged and loses credit; blank rows are ignored", () => {
  const r = gradeJournalEntry(
    [line("Accounts Receivable", 5000, null), line("Sales Revenue", null, 4000), line("Unearned Revenue", null, 900), line("", null, null)],
    key
  );
  assert.equal(r.balanced, false);
  assert.equal(r.fraction, 2 / 3);
});

test("JE: a line with both debit and credit never matches", () => {
  const r = gradeJournalEntry(
    [line("Accounts Receivable", 5000, 5000), line("Sales Revenue", null, 4000), line("Unearned Revenue", null, 1000)],
    key
  );
  assert.equal(r.fraction, 2 / 3);
});

const fields: TbsField[] = [
  { id: "f1", type: "numeric", label: "Revenue", points: 2 },
  { id: "f2", type: "option_list", label: "Opinion", points: 1, options: ["Unmodified", "Qualified"] },
  { id: "f3", type: "journal_entry", label: "Entry", points: 3, accounts: ["Accounts Receivable", "Sales Revenue", "Unearned Revenue"] },
];
const answerKey: TbsAnswerKey = {
  f1: { type: "numeric", value: 4000 },
  f2: { type: "option_list", value: "Qualified" },
  f3: { type: "journal_entry", lines: [...key] },
};

test("gradeTbs: score = earned / total with per-field results and revealed answers", () => {
  const r = gradeTbs(fields, answerKey, {
    f1: 4000,
    f2: "Unmodified",
    f3: [line("Accounts Receivable", 5000, null), line("Sales Revenue", null, 4000)],
  });
  assert.equal(r.maxScore, 6);
  assert.equal(r.score, 4);
  assert.equal(r.percent, 67);
  assert.deepEqual(
    r.fieldResults.map((f) => [f.fieldId, f.correct, f.earned]),
    [["f1", true, 2], ["f2", false, 0], ["f3", false, 2]]
  );
  assert.equal(r.fieldResults[1].expected, "Qualified");
  assert.match(r.fieldResults[2].expected, /Dr Accounts Receivable 5,000/);
});

test("gradeTbs: ignores client-claimed scores; unanswered and keyless fields earn 0", () => {
  const r = gradeTbs(fields, { f1: answerKey.f1 }, {});
  assert.equal(r.score, 0);
  assert.equal(r.fieldResults[1].note, "No answer key");
});

// ── Trial access flow (mirrors GET /api/tbs/[id]) ──
test("trial: sample opens (consumes), a 2nd task is locked, re-opening is free; Pro unlimited", () => {
  const sample = { id: "s", isSample: true };
  const other = { id: "o", isSample: false };
  const consumed = new Set<string>();

  assert.equal(decideTbsOpen("trial", sample, consumed), "consume");
  consumed.add(sample.id); // consume_trial_item recorded it
  assert.equal(decideTbsOpen("trial", other, consumed), "locked");
  assert.equal(decideTbsOpen("trial", sample, consumed), "open");
  assert.equal(decideTbsOpen("pro", other, new Set()), "open");
});

test("toPublicTask strips server-only columns (explanation, sample flag, keys)", () => {
  const row: TbsTaskRow = {
    id: "t",
    section: "far",
    subtopicId: null,
    title: "T",
    difficulty: "easy",
    instructions: "",
    exhibits: [],
    fields,
    estMinutes: 10,
    explanation: "SECRET explanation",
    isSample: true,
  };
  const serialized = JSON.stringify(toPublicTask(row));
  assert.ok(!serialized.includes("SECRET"));
  for (const secret of ["value", "lines", "tolerance", "answers", "explanation", "isSample"]) {
    assert.ok(!serialized.includes(`"${secret}"`), `public task leaks "${secret}"`);
  }
});
