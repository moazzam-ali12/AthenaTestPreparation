// Multi-step UI flows shared by specs.
import type { Page } from "@playwright/test";
import { expect, api, open } from "./fixtures";
import { correctOptions, quizApi, quizPath, type SubtopicRef } from "./state";
import { q } from "./db";

const esc = (s: string) => s.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const optionButton = (page: Page, text: string) =>
  page.getByRole("button", { name: new RegExp(esc(text)) }).filter({ visible: true }).first();

/**
 * Quiz Q1: miss twice -> stuck modal -> tutor page -> answer correctly -> practice loop,
 * then miss the practice question twice. Leaves the page at whatever the app does next.
 */
export async function missTwiceInPractice(page: Page, sub: SubtopicRef) {
  const q1 = (await api(page, "GET", quizApi(sub))).body.problems[0];
  q1.correctOption = (await correctOptions([q1.id])).get(q1.id)!;
  await open(page, quizPath(sub, 1));
  // The quiz payload no longer carries the key (server-graded): read it from the DB.
  const [{ correct_option: key }] = await q<{ correct_option: number }>(
    "select correct_option from problems where id = $1", [q1.id]
  );
  q1.correctOption = key;
  const wrong = (key + 1) % q1.options.length;
  // First miss is server-checked; a click while it's pending is ignored, so wait for it.
  const checked = page.waitForResponse((r) => r.url().includes("/api/act-quiz/answer"), { timeout: 60_000 });
  await optionButton(page, q1.options[wrong]).click();
  await checked;
  await page.waitForTimeout(800);
  await optionButton(page, q1.options[wrong]).click();
  await page.waitForURL(/\/quiz\/1\/tutor$/, { timeout: 30_000 });

  const practiceResp = page.waitForResponse((r) => r.url().includes("/practice-problems") && r.ok(), { timeout: 90_000 });
  await optionButton(page, q1.options[q1.correctOption]).click();
  const practice = (await (await practiceResp).json()).problems as any[];
  expect(practice.length, "practice problems served").toBeGreaterThan(0);

  // Answer wrong until both practice questions are exhausted, stopping when the app reacts
  // (refresher card, or navigation away from /tutor). Correct answers come from the DB and are
  // compared on letters only, because KaTeX rewrites "$" amounts in the rendered text.
  const norm = (s: string) => s.replace(/[^a-z]/gi, "").toLowerCase().slice(0, 60);
  const keys = await q<{ t: string }>(
    "select options->>correct_option as t from problems where source = 'practice' and subtopic_id = $1",
    [sub.id]
  );
  const correctTexts = keys.map((k) => norm(k.t));
  const card = page.locator(".fixed.top-20");
  clickLog.length = 0;
  clickLog.push(`tutor-correct-click: ${q1.options[q1.correctOption].slice(0, 50)}`);
  for (let clicks = 0; clicks < 10; clicks++) {
    if (!/\/tutor$/.test(page.url())) break;
    if (await page.getByText("Need a refresher?").isVisible()) break;
    const buttons = card.getByRole("button");
    let clicked = false;
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      const text = norm((await b.textContent()) ?? "").replace(/^[a-d](?=[a-z])/, "");
      if (text.length < 20 || correctTexts.some((c) => c.startsWith(text.slice(0, 40)) || text.startsWith(c.slice(0, 40)))) continue;
      if (!(await b.isEnabled())) continue;
      const graded = page
        .waitForResponse((r) => r.url().includes("/practice-problems") && r.request().method() === "POST", { timeout: 30_000 })
        .catch(() => null);
      await b.click({ timeout: 5_000 }).then(() => (clicked = true), () => {});
      if (clicked) {
        clickLog.push(`click ${clicks}: ${text.slice(0, 50)}`);
        await page.screenshot({ path: `test-results/practice-click-${clicks}.png` });
        // After a miss the card shows a hint or (2nd miss) the revealed answer, never "Correct!".
        await graded;
        await card.locator('[data-practice-status]:not([data-practice-status="grading"])')
          .waitFor({ timeout: 10_000 }).catch(() => {});
        if (await card.getByText(/^The answer is [A-D]\.$/).isVisible()) clickLog.push("revealed");
        if (await card.getByText("Correct!").isVisible()) clickLog.push("FALSE-CORRECT");
        break;
      }
    }
    await page.waitForTimeout(clicked ? 1_500 : 3_000);
  }
}

export const clickLog: string[] = [];

/**
 * Gives an account real progress through the app's own APIs: an AUD quiz with answers, the AUD
 * sample TBS submitted, the 15-question sample test submitted, and today's daily quest completed.
 */
export async function buildProgress(page: Page, sub: SubtopicRef) {
  const quiz = (await api(page, "GET", quizApi(sub))).body;
  expect(quiz.problems?.length, "quiz served").toBeGreaterThan(0);
  const first5 = quiz.problems.slice(0, 5);
  const keys = await correctOptions(first5.map((p: any) => p.id));
  const answers = first5.map((p: any, i: number) => {
    const c = keys.get(p.id)!;
    const selectedOption = i < 3 ? c : (c + 1) % p.options.length;
    return { problemId: p.id, selectedOption, isCorrect: i < 3, responseTimeMs: 4000 };
  });
  // Each answer is graded (and, in the trial, counted) one at a time, as the quiz UI does.
  for (const a of answers) {
    const r = await api(page, "POST", "/api/act-quiz/answer", { problemId: a.problemId, selectedOption: a.selectedOption });
    expect(r.status, `answer ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  }
  const submit = await api(page, "POST", "/api/act-quiz/submit", {
    subtopicId: sub.id, score: 3, totalQuestions: 5, timeElapsedSeconds: 120, answers,
  });
  expect(submit.status, `quiz submit ${JSON.stringify(submit.body).slice(0, 200)}`).toBe(200);

  const tasks = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as any[];
  const tbs = tasks.find((t) => t.isSample)!;
  await api(page, "GET", `/api/tbs/${tbs.id}`);
  const tbsSubmit = await api(page, "POST", `/api/tbs/${tbs.id}/submit`, { responses: {}, timeSpentSeconds: 90 });
  expect(tbsSubmit.status, "tbs submit").toBe(200);

  const start = (await api(page, "POST", "/api/practice-exam/start", { section: "AUD" })).body;
  for (const p of start.problems.slice(0, 3)) {
    await api(page, "POST", "/api/practice-exam/answer", {
      attemptId: start.attemptId, problemId: p.problemId, module: p.module, orderIndex: p.orderIndex, selectedOption: 0,
    });
  }
  const examSubmit = await api(page, "POST", "/api/practice-exam/submit", { attemptId: start.attemptId, totalTimeSeconds: 200 });
  expect(examSubmit.status, "sample submit").toBe(200);

  let quest = await api(page, "GET", "/api/daily-quest");
  const qp = () => (quest.body?.problems ?? quest.body?.quest?.problems ?? []) as any[];
  if (!qp().length) {
    await api(page, "POST", "/api/daily-quest/generate");
    quest = await api(page, "GET", "/api/daily-quest");
  }
  for (const p of qp()) await api(page, "POST", "/api/daily-quest/answer", { questProblemId: p.id, selectedOption: 0 });
  const questId = quest.body?.quest?.id ?? quest.body?.id;
  await api(page, "POST", "/api/daily-quest/complete", { questId, timeElapsedSeconds: 60 });
  return { examAttemptId: start.attemptId as string, tbsId: tbs.id as string };
}

/**
 * The answer-option buttons of the current question, by position. Options render as "A …", "B …"
 * (KaTeX rewrites the text, so position is the stable handle): finds the run A, B, C, D.
 */
export async function answerOption(page: Page, index: number, count: number) {
  const candidates = page.getByRole("button", { name: /^[A-H]/ }).filter({ visible: true });
  const letters = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
  let start = -1;
  await expect
    .poll(async () => {
      const texts = (await candidates.allInnerTexts()).map((t) => t.trim()[0]);
      start = texts.findIndex((_, i) => letters.every((l, j) => texts[i + j] === l));
      return start;
    }, { message: "answer options A..D rendered" })
    .toBeGreaterThanOrEqual(0);
  return candidates.nth(start + index);
}

/** Today's daily quest via the app's API (GET auto-generates it). */
export async function todaysQuest(page: Page) {
  const r = await api(page, "GET", "/api/daily-quest");
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  return r.body as { quest: { id: string } | null; problems: any[] | null };
}

const escLong = (s: string) => s.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const optionButtonLong = (page: Page, text: string) =>
  page.getByRole("button", { name: new RegExp(escLong(text)) }).filter({ visible: true }).first();
