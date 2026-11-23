// Cross-checks generator output against the TS schema + grader:
// answering every field with its own key must score 100%.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { tbsExhibitSchema, tbsFieldSchema, tbsAnswerKeySchema, type TbsResponses } from "../src/lib/tbs/schema";
import { gradeTbs } from "../src/lib/tbs/grade";

type Rec = { section: string; status: string; is_sample?: boolean; task?: { exhibits: unknown; fields: unknown; answers: Record<string, Record<string, unknown>> } };
const recs = JSON.parse(readFileSync(process.argv[2], "utf-8")) as Rec[];
let ok = 0, bad = 0;
for (const r of recs.filter((x) => x.status !== "rejected")) {
  const ex = z.array(tbsExhibitSchema).safeParse(r.task!.exhibits);
  const fields = z.array(tbsFieldSchema).safeParse(r.task!.fields);
  const key = tbsAnswerKeySchema.safeParse(r.task!.answers);
  if (!ex.success || !fields.success || !key.success) { bad++; console.log("schema fail", r.section, ex.error?.message ?? fields.error?.message ?? key.error?.message); continue; }
  const responses: TbsResponses = {};
  for (const [id, k] of Object.entries(key.data)) {
    responses[id] = k.type === "journal_entry"
      ? [...k.lines].reverse().map((l) => ({ account: l.account, debit: l.side === "debit" ? l.amount : null, credit: l.side === "credit" ? l.amount : null }))
      : k.value;
  }
  const g = gradeTbs(fields.data, key.data, responses);
  if (g.percent === 100) ok++; else { bad++; console.log("grade", r.section, g.percent); }
}
console.log(`schema+grader round-trip: ${ok} ok, ${bad} bad`);
