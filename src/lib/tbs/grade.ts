// Pure TBS grading. No I/O — runs server-side against the stored answer key.
import type {
  JeLine,
  TbsAnswerKey,
  TbsField,
  TbsFieldKey,
  TbsFieldResult,
  TbsResponses,
  TbsResponseValue,
} from "./schema";

type JeKeyLine = Extract<TbsFieldKey, { type: "journal_entry" }>["lines"][number];

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const normAccount = (s: string) => s.trim().toLowerCase();

/** Numeric: compare after rounding to whole units, within the key's tolerance. */
export function gradeNumeric(response: TbsResponseValue | undefined, value: number, tolerance = 0) {
  if (typeof response !== "number" || !Number.isFinite(response)) return 0;
  return Math.abs(Math.round(response) - Math.round(value)) <= tolerance ? 1 : 0;
}

/** Option list: exact match on the chosen option text. */
export function gradeOption(response: TbsResponseValue | undefined, value: string) {
  return typeof response === "string" && response === value ? 1 : 0;
}

type NormalizedLine = { account: string; side: "debit" | "credit"; amount: number } | null;

/** A response line is valid when it has an account and exactly one positive side. */
function normalizeLine(line: JeLine): NormalizedLine {
  const account = normAccount(line.account);
  const debit = line.debit ?? 0;
  const credit = line.credit ?? 0;
  if (!account) return null;
  if (debit > 0 && credit <= 0) return { account, side: "debit", amount: Math.round(debit) };
  if (credit > 0 && debit <= 0) return { account, side: "credit", amount: Math.round(credit) };
  return null;
}

function isBlank(line: JeLine) {
  return !line.account.trim() && !line.debit && !line.credit;
}

/**
 * Journal entry, order-independent. Each expected line is matched to at most
 * one response line with the same account, side and (rounded) amount.
 * Credit = matched / max(expected lines, response lines), so missing lines,
 * extra lines and wrong sides each lose a share of the points.
 */
export function gradeJournalEntry(
  response: TbsResponseValue | undefined,
  expected: readonly JeKeyLine[]
): { fraction: number; balanced: boolean } {
  const lines = Array.isArray(response) ? response.filter((l) => !isBlank(l)) : [];
  const normalized = lines.map(normalizeLine);

  const debits = normalized.reduce((s, l) => s + (l?.side === "debit" ? l.amount : 0), 0);
  const credits = normalized.reduce((s, l) => s + (l?.side === "credit" ? l.amount : 0), 0);
  const balanced = lines.length > 0 && debits === credits;

  const used = new Set<number>();
  let matched = 0;
  for (const exp of expected) {
    const idx = normalized.findIndex(
      (l, i) =>
        !used.has(i) &&
        l !== null &&
        l.account === normAccount(exp.account) &&
        l.side === exp.side &&
        l.amount === Math.round(exp.amount)
    );
    if (idx !== -1) {
      used.add(idx);
      matched += 1;
    }
  }

  const denominator = Math.max(expected.length, lines.length);
  return { fraction: denominator === 0 ? 0 : matched / denominator, balanced };
}

export function describeKey(key: TbsFieldKey): string {
  switch (key.type) {
    case "numeric":
      return fmtAmount(key.value);
    case "option_list":
      return key.value;
    case "journal_entry":
      return key.lines
        .map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.account} ${fmtAmount(l.amount)}`)
        .join("; ");
  }
}

export type TbsGradeResult = {
  score: number;
  maxScore: number;
  percent: number;
  fieldResults: TbsFieldResult[];
};

/** Grades every public field. A field with no key earns nothing (and is logged by the caller). */
export function gradeTbs(fields: readonly TbsField[], key: TbsAnswerKey, responses: TbsResponses): TbsGradeResult {
  const fieldResults: TbsFieldResult[] = fields.map((field) => {
    const fieldKey = key[field.id];
    const response = responses[field.id];
    const possible = field.points;

    if (!fieldKey || fieldKey.type !== field.type) {
      return { fieldId: field.id, earned: 0, possible, correct: false, expected: "", note: "No answer key" };
    }

    let fraction = 0;
    let note: string | undefined;
    if (fieldKey.type === "numeric") {
      fraction = gradeNumeric(response, fieldKey.value, fieldKey.tolerance ?? 0);
    } else if (fieldKey.type === "option_list") {
      fraction = gradeOption(response, fieldKey.value);
    } else {
      const je = gradeJournalEntry(response, fieldKey.lines);
      fraction = je.fraction;
      if (!je.balanced && Array.isArray(response) && response.length > 0) {
        note = "Your entry did not balance (debits ≠ credits).";
      }
    }

    const earned = round2(possible * fraction);
    return { fieldId: field.id, earned, possible, correct: fraction === 1, expected: describeKey(fieldKey), note };
  });

  const score = round2(fieldResults.reduce((s, r) => s + r.earned, 0));
  const maxScore = round2(fieldResults.reduce((s, r) => s + r.possible, 0));
  const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100);
  return { score, maxScore, percent, fieldResults };
}
