// Area F: quiz security/lock fixes — CPA practice payload, feedback after each answer (API + UI),
// per-section unlock chains for trial and Pro. Runs in full-trial mode.
import { test, expect, api, open, type Leak } from "../lib/fixtures";
import { closeDb } from "../lib/db";
import { correctOptions, ensurePracticeProblems, quizApi, quizPath, resetToFreshTrial, subtopicsOf, type Section } from "../lib/state";
import type { Page } from "@playwright/test";

const SECTIONS: Section[] = ["aud", "far", "reg", "bar", "isc", "tcp"];
const REVEAL = ["correctOption", "explanation", "solutionSteps", "hint", "detailedHint", "optionHints"];

test.beforeAll(async () => {
  await resetToFreshTrial("trial");
  await ensurePracticeProblems((await subtopicsOf("aud"))[0]);
});
test.afterAll(closeDb);

const subPath = (s: { topicSlug: string; subtopicSlug: string }) =>
  `${encodeURIComponent(s.topicSlug)}/${encodeURIComponent(s.subtopicSlug)}`;

test("F CPA practice: no keys before answering, graded per answer", async ({ as, leaks }) => {
  const page = await as("trial");
  const sub = (await subtopicsOf("aud"))[0];
  const url = `/api/learning/${subPath(sub)}/practice-problems`;
  const res = await api(page, "GET", url);
  expect(res.status).toBe(200);
  const problems = res.body.problems as any[];
  expect(problems.length).toBeGreaterThan(0);
  // The generic hint is shown on demand by the practice card; key, explanation, steps and option hints are not sent.
  const PRACTICE_REVEAL = ["correctOption", "explanation", "solutionSteps", "optionHints"];
  expect(problems.flatMap((p) => PRACTICE_REVEAL.filter((k) => k in p)), "practice reveal fields").toEqual([]);
  expect(leaks.filter((l: Leak) => l.url.includes("/practice-problems")), "practice payload").toEqual([]);

  const p0 = problems[0];
  const key = (await correctOptions([p0.id])).get(p0.id)!;
  const right = await api(page, "POST", url, { problemId: p0.id, selectedOption: key, reveal: false });
  expect(right.status).toBe(200);
  expect(right.body.isCorrect).toBe(true);
  expect(right.body.answer?.correctOption).toBe(key);
  expect(typeof right.body.answer?.explanation).toBe("string");
});

test("F feedback after each answer: quiz + daily quest APIs return verdict, key, explanation", async ({ as }) => {
  const page = await as("trial");
  const quiz = (await api(page, "GET", quizApi((await subtopicsOf("aud"))[0]))).body.problems as any[];
  for (const p of quiz.slice(0, 2)) {
    const r = await api(page, "POST", "/api/act-quiz/answer", { problemId: p.id, selectedOption: 0 });
    expect(r.status).toBe(200);
    expect(typeof r.body.isCorrect).toBe("boolean");
    expect(r.body.correctOption).toBeGreaterThanOrEqual(0);
    expect(typeof r.body.explanation).toBe("string");
    expect(r.body.isCorrect).toBe(r.body.correctOption === 0);
  }

  let quest = await api(page, "GET", "/api/daily-quest");
  const open_ = () => ((quest.body?.problems ?? []) as any[]).filter((p) => p.selectedOption == null);
  if (!open_().length) {
    await api(page, "POST", "/api/daily-quest/generate");
    quest = await api(page, "GET", "/api/daily-quest");
  }
  const qp = open_()[0];
  expect(qp, "an unanswered quest problem").toBeTruthy();
  const a = await api(page, "POST", "/api/daily-quest/answer", { questProblemId: qp.id, selectedOption: 0, responseTimeMs: 4000 });
  expect(a.status, JSON.stringify(a.body).slice(0, 200)).toBe(200);
  expect(typeof a.body.isCorrect).toBe("boolean");
  expect(a.body.correctOption, "quest key after answering").toBeGreaterThanOrEqual(0);
  expect(typeof a.body.explanation, "quest explanation after answering").toBe("string");
});

test("F feedback in the quiz UI: ✓ on the key, ✗ + hint on a miss", async ({ as }) => {
  const page: Page = await as("trial");
  const sub = (await subtopicsOf("far"))[0];
  const problems = (await api(page, "GET", quizApi(sub))).body.problems as any[];
  const keys = await correctOptions(problems.slice(0, 2).map((p) => p.id));
  const options = () => page.locator("button").filter({ visible: true }).filter({ has: page.locator("span") });
  const optionButton = (text: string) => {
    const esc = text.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return options().filter({ hasText: new RegExp(esc) }).first();
  };

  // Q1: the right answer turns green.
  await open(page, quizPath(sub, 1));
  const q1 = problems[0];
  const right = q1.options[keys.get(q1.id)!];
  await expect(optionButton(right)).toBeVisible({ timeout: 60_000 });
  const r1 = page.waitForResponse((r) => r.url().includes("/api/act-quiz/answer"));
  await optionButton(right).click();
  expect((await (await r1).json()).isCorrect).toBe(true);
  await expect(optionButton(right)).toHaveClass(/border-athena-success/);

  // Q2: a wrong answer turns red and shows the hint panel with the opt-in solution.
  await open(page, quizPath(sub, 2));
  const q2 = problems[1];
  const wrong = q2.options[(keys.get(q2.id)! + 1) % q2.options.length];
  await expect(optionButton(wrong)).toBeVisible({ timeout: 60_000 });
  const r2 = page.waitForResponse((r) => r.url().includes("/api/act-quiz/answer"));
  await optionButton(wrong).click();
  const fb = await (await r2).json();
  expect(fb.isCorrect).toBe(false);
  await expect(optionButton(wrong)).toHaveClass(/border-destructive/);
  if (fb.hint || (fb.optionHints ?? []).length) {
    await expect(page.getByText(/Still stuck\? Show step-by-step solution/)).toBeVisible();
  }
});

for (const role of ["trial", "pro"] as const) {
  test(`F section locks (${role}): first subtopic of all six sections opens, order within a section holds`, async ({ as }) => {
    const page = await as(role);
    const topics = (await api(page, "GET", "/api/learning")).body.topics as any[];
    const locked = new Map<string, boolean>(topics.flatMap((t) => t.subtopics.map((s: any) => [s.id, s.locked])));
    for (const s of SECTIONS) {
      const subs = await subtopicsOf(s);
      expect(subs.length, `${s} has subtopics`).toBeGreaterThan(0);
      expect(locked.get(subs[0].id), `${s} first subtopic unlocked`).toBe(false);
      const quiz = await api(page, "GET", quizApi(subs[0]));
      expect(quiz.status, `first ${s} quiz`).toBe(200);
      // Chain order: once a subtopic is locked, every later one in the section is locked too.
      const flags = subs.map((x) => locked.get(x.id));
      const firstLocked = flags.indexOf(true);
      if (firstLocked > 0) {
        expect(flags.slice(firstLocked).every((f) => f === true), `${s} chain order`).toBe(true);
        expect((await api(page, "GET", quizApi(subs[firstLocked]))).status, `${s} locked subtopic quiz`).toBe(403);
      }
    }
    if (role === "trial") {
      // Fresh trial: the 2nd subtopic of every section with more than one is locked.
      for (const s of SECTIONS) {
        const subs = await subtopicsOf(s);
        if (subs.length > 1) expect(locked.get(subs[1].id), `${s} 2nd subtopic locked for a fresh trial`).toBe(true);
      }
    }
  });
}
