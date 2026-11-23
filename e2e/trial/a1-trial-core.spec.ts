// Area A (part 1): trial banner, sections, MCQ quota, TBS quota, locked features, /pricing.
import { test, expect, api, open } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import {
  resetToFreshTrial, setTrialEndsIn, subtopicsOf, passSubtopics, quizPath, quizApi, type Section,
} from "../lib/state";

const SECTIONS: Section[] = ["aud", "far", "reg", "bar", "isc", "tcp"];
const UPGRADE_MCQ = "You've used your free questions";
const UPGRADE_TBS = "Sample simulation used";
const UPGRADE_LOCKED = "This is a Pro feature";

import { TRIAL_MODE } from "../lib/env";

// Quota-trial spec: runs only against TRIAL_MODE = 'limited' (E2E_TRIAL_MODE=limited).
test.skip(TRIAL_MODE !== "limited", "limited-trial spec; the app runs the full trial");

test.beforeAll(async () => {
  await resetToFreshTrial("trial");
  await resetToFreshTrial("trial-lastday");
  await setTrialEndsIn("trial-lastday", "12 hours");
});
test.afterAll(closeDb);

test("A banner: days left, and last-day copy", async ({ as, browser }) => {
  const page = await as("trial");
  await open(page, "/dashboard");
  await expect(page.getByText(/Free trial: [67] days left · View Plans/)).toBeVisible();

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  const { signIn } = await import("../lib/fixtures");
  await signIn(p2, "trial-lastday");
  await open(p2, "/dashboard");
  await expect(p2.getByText("Free trial: last day · View Plans")).toBeVisible();
  await expect(p2.getByText(/Your free trial ends today/)).toBeVisible();
  await ctx.close();
});

test("A every CPA section opens (learning tabs, TBS list, exam status)", async ({ as }) => {
  const page = await as("trial");
  await open(page, "/learning");
  for (const s of SECTIONS) {
    await page.getByRole("button", { name: new RegExp(`^${s}`, "i") }).first().click();
    await expect(page.getByText(new RegExp(`free questions used in\\s*${s}`, "i"))).toBeVisible();
    expect((await api(page, "GET", `/api/tbs?section=${s}`)).status, `tbs ${s}`).toBe(200);
    expect((await api(page, "GET", `/api/practice-exam?section=${s.toUpperCase()}`)).status, `exam ${s}`).toBe(200);
    // Per-section unlock chains: the first subtopic of every section opens a quiz.
    const quiz = await api(page, "GET", quizApi((await subtopicsOf(s))[0]));
    expect(quiz.status, `first ${s} quiz`).toBe(200);
    expect(quiz.body.problems?.length ?? 0, `first ${s} quiz questions`).toBeGreaterThan(0);
  }
  // Opening quizzes counts nothing.
  expect(Object.values((await api(page, "GET", "/api/trial")).body.usage.mcq).every((n) => !n)).toBe(true);
});

test("A MCQ quota: counted on first answer, 11th new question 402 + modal, re-answer free, other section fresh", async ({ as }) => {
  const page = await as("trial");
  const aud = await subtopicsOf("aud");
  const far = await subtopicsOf("far");
  const usage = async () => (await api(page, "GET", "/api/trial")).body.usage.mcq as Record<string, number | undefined>;
  const counter = async (section: string, n: number) => {
    await open(page, "/learning");
    await page.getByRole("button", { name: new RegExp(`^${section}`, "i") }).first().click();
    await expect(page.getByText(new RegExp(`Free trial: ${n} / 10 free questions used in\\s*${section}`, "i"))).toBeVisible();
  };

  // Viewing question 1 costs nothing.
  const quiz = (await api(page, "GET", quizApi(aud[0]))).body;
  expect(quiz.problems.length, "trial quiz capped at the section quota").toBeLessThanOrEqual(10);
  const q1 = quiz.problems[0];
  await open(page, quizPath(aud[0], 1));
  await expect(page.getByRole("button", { name: /^(Next|Submit|Finish)$/ }).first()).toBeVisible({ timeout: 60_000 });
  expect((await usage()).aud ?? 0, "after viewing Q1").toBe(0);

  // Answering it in the UI counts 1 and still gives ✓/✗ feedback from the server.
  const answered = page.waitForResponse((r) => r.url().includes("/api/act-quiz/answer"));
  const esc = (t: string) => t.slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(esc(q1.options[0])) }).filter({ visible: true }).first().click();
  const fb = await (await answered).json();
  expect(typeof fb.isCorrect, "server verdict").toBe("boolean");
  expect(fb.correctOption, "key revealed after answering").toBeGreaterThanOrEqual(0);
  expect((await usage()).aud, "after answering Q1").toBe(1);
  await counter("AUD", 1);

  // Answer the rest of the served questions: the section reaches 10/10.
  for (const p of quiz.problems.slice(1, 10)) {
    const r = await api(page, "POST", "/api/act-quiz/answer", { problemId: p.id, selectedOption: 0 });
    expect(r.status).toBe(200);
  }
  expect((await usage()).aud).toBe(Math.min(quiz.problems.length, 10));

  if (quiz.problems.length >= 10) {
    // An 11th, never-answered AUD question -> 402.
    const counted = quiz.problems.slice(0, 10).map((p: any) => p.id);
    const [fresh] = await q<{ id: string }>(
      "select id from problems where source = 'cpa' and subtopic_id = $1 and not (id = any($2::uuid[])) limit 1",
      [aud[0].id, counted]
    );
    if (fresh) {
      const r11 = await api(page, "POST", "/api/act-quiz/answer", { problemId: fresh.id, selectedOption: 0 });
      expect(r11.status).toBe(402);
      expect(r11.body.code).toBe("TRIAL_LIMIT");
    }
    // Opening a quiz with only new questions -> 402 + modal (direct link and overview "Take quiz").
    await passSubtopics("trial", [aud[0]]);
    const second = await api(page, "GET", quizApi(aud[1]));
    expect(second.status).toBe(402);
    expect(second.body.kind).toBe("mcq");
    await open(page, quizPath(aud[1], 1));
    await expect.soft(page.getByText(UPGRADE_MCQ), "modal on direct link to an over-quota quiz").toBeVisible({ timeout: 10_000 });
    await open(page, quizPath(aud[1], 1).replace(/\/quiz\/1$/, ""));
    await page.getByText("Take quiz", { exact: false }).first().click();
    await expect(page.getByText(UPGRADE_MCQ)).toBeVisible();
  }

  // Re-answering / re-opening an already-counted question is free.
  const before = (await usage()).aud;
  expect((await api(page, "POST", "/api/act-quiz/answer", { problemId: q1.id, selectedOption: 1 })).status).toBe(200);
  const again = await api(page, "GET", quizApi(aud[0]));
  expect(again.status).toBe(200);
  expect(again.body.problems.length).toBeGreaterThan(0);
  expect((await usage()).aud).toBe(before);

  // FAR has its own 10 and its own unlock chain (no AUD progress needed).
  const farQuiz = await api(page, "GET", quizApi(far[0]));
  expect(farQuiz.status, JSON.stringify(farQuiz.body).slice(0, 200)).toBe(200);
  expect(farQuiz.body.problems.length).toBeLessThanOrEqual(10);
  expect((await usage()).far ?? 0).toBe(0);
  await counter("FAR", 0);
});

test("A TBS: sample opens, autosave survives refresh, submit grades per field, 2nd is locked, 1st re-opens", async ({ as, leaks }) => {
  const page = await as("trial");
  const list = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as any[];
  const sample = list.find((t) => t.isSample)!;
  const other = list.find((t) => !t.isSample)!;
  expect(sample, "a sample TBS exists").toBeTruthy();

  await open(page, `/learning/aud/tbs/${sample.id}`);
  await expect(page.getByText(sample.title).first()).toBeVisible({ timeout: 60_000 });

  const task = (await api(page, "GET", `/api/tbs/${sample.id}`)).body.task;
  const responses: Record<string, unknown> = {};
  for (const f of task.fields) {
    if (f.type === "numeric") responses[f.id] = 1234;
    else if (f.type === "option_list") responses[f.id] = (f.options?.[0]?.id ?? f.options?.[0]) as string;
    else if (f.type === "journal_entry") responses[f.id] = [{ account: f.accounts[0], debit: 100, credit: null }];
  }
  const save = await api(page, "PUT", `/api/tbs/${sample.id}/attempt`, { responses, timeSpentSeconds: 42 });
  expect(save.status, JSON.stringify(save.body)).toBe(200);
  await page.reload();
  await expect(page.getByText(sample.title).first()).toBeVisible();
  const reloaded = (await api(page, "GET", `/api/tbs/${sample.id}`)).body.attempt;
  expect(reloaded.responses).toEqual(responses);
  expect(reloaded.timeSpentSeconds).toBeGreaterThanOrEqual(42);
  expect(leaks.filter((l) => l.url.includes("/api/tbs")), "no TBS answer keys before submit").toEqual([]);

  const submit = await api(page, "POST", `/api/tbs/${sample.id}/submit`, { responses, timeSpentSeconds: 60 });
  expect(submit.status, JSON.stringify(submit.body).slice(0, 300)).toBe(200);
  const perField = JSON.stringify(submit.body);
  for (const f of task.fields) expect(perField, `result for field ${f.id}`).toContain(`"${f.id}"`);

  if (other) {
    const second = await api(page, "GET", `/api/tbs/${other.id}`);
    expect(second.status).toBe(402);
    expect(second.body.kind).toBe("tbs");
    // Direct link to a locked TBS should explain why (soft: records the silent bounce).
    await open(page, `/learning/aud/tbs/${other.id}`);
    await expect.soft(page.getByText(UPGRADE_TBS), "modal on direct link to 2nd TBS").toBeVisible({ timeout: 10_000 });
    // Normal path: the Simulations list on /learning shows it locked and opens the modal.
    await open(page, "/learning");
    await page.getByRole("button", { name: /^AUD/ }).first().click();
    await page.getByText(other.title).first().click();
    await expect(page.getByText(UPGRADE_TBS)).toBeVisible();
  }
  expect((await api(page, "GET", `/api/tbs/${sample.id}`)).status).toBe(200);
});

test("A locked: mentor, micro-lessons, full mock exam — pages and APIs", async ({ as }) => {
  const page = await as("trial");
  const aud = await subtopicsOf("aud");
  const sub = `${encodeURIComponent(aud[0].topicSlug)}/${encodeURIComponent(aud[0].subtopicSlug)}`;

  for (const path of ["/mentor", `/learning/${sub}/micro-lesson`]) {
    await open(page, path);
    // Middleware bounces to /dashboard?locked=locked; the modal then drops the param.
    await expect(page, path).toHaveURL(/\/dashboard/);
    await expect(page.getByText(UPGRADE_LOCKED)).toBeVisible();
  }
  await open(page, "/practice-exam");
  await page.getByRole("button", { name: /Full-length mock exam/ }).first().click();
  await expect(page.getByText(UPGRADE_LOCKED)).toBeVisible();

  const apis: [string, string, unknown?][] = [
    ["POST", "/api/agent/mentor-chat/stream", { message: "hi" }],
    ["POST", "/api/agent/micro-lesson/stream", {}],
    ["GET", `/api/learning/${sub}/micro-lesson`],
    ["GET", "/api/my-learning/topics"],
  ];
  for (const [m, url, body] of apis) {
    const r = await page.request.fetch(url, { method: m, data: body });
    expect(r.status(), `${m} ${url}`).toBe(402);
    expect((await r.json()).code, url).toBe("FEATURE_LOCKED");
  }
});

test("A /pricing redirects to /subscribe", async ({ as }) => {
  const page = await as("trial");
  await open(page, "/pricing");
  await expect(page).toHaveURL(/\/subscribe(\?|$)/);
});
