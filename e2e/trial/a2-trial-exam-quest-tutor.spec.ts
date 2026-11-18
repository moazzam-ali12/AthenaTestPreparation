// Area A (part 2): sample test, daily quest, AI tutor counter + cap.
import { test, expect, api, apiStream, open } from "../lib/fixtures";
import { closeDb, one, q } from "../lib/db";
import { resetToFreshTrial, setTutorUsedToday, subtopicsOf, trialUsage, userRow } from "../lib/state";
import type { Page } from "@playwright/test";

import { TRIAL_MODE } from "../lib/env";

// Quota-trial spec: runs only against TRIAL_MODE = 'limited' (E2E_TRIAL_MODE=limited).
test.skip(TRIAL_MODE !== "limited", "limited-trial spec; the app runs the full trial");

const ROLE = "trial" as const;
test.beforeAll(async () => resetToFreshTrial(ROLE));
test.afterAll(closeDb);

const timerSeconds = async (page: Page) => {
  const t = await page.getByText(/^\d{1,2}:\d{2}$/).first().textContent();
  const [m, s] = t!.split(":").map(Number);
  return m * 60 + s;
};

test("A sample test: 24:00 timer, refresh keeps answers + time, results without pass badge, review, 2nd blocked", async ({ as, leaks }) => {
  const page = await as(ROLE);
  await open(page, "/practice-exam");
  await page.getByRole("button", { name: "Start sample" }).first().click();
  await page.waitForURL(/\/practice-exam\/[0-9a-f-]{36}\/\d+/, { timeout: 60_000 });
  const attemptId = page.url().match(/practice-exam\/([0-9a-f-]{36})/)![1];

  const t0 = await timerSeconds(page);
  expect(t0).toBeGreaterThan(23 * 60 + 30);
  expect(t0).toBeLessThanOrEqual(24 * 60);

  // Answer Q1 and Q2 through the UI.
  const attempt = (await api(page, "GET", `/api/practice-exam/attempts/${attemptId}`)).body;
  expect(attempt.problems).toHaveLength(15);
  for (const n of [1, 2]) {
    const prob = attempt.problems[n - 1];
    await page.getByRole("button", { name: new RegExp(escapeRe(prob.options[0].slice(0, 30))) }).first().click();
    await page.waitForResponse((r) => r.url().includes("/api/practice-exam/answer") && r.ok());
    if (n === 1) await page.getByRole("button", { name: "Next" }).click();
  }
  await page.waitForTimeout(3_000);
  const beforeReload = await timerSeconds(page);
  await page.reload();
  const afterReload = await timerSeconds(page);
  expect(afterReload, "timer is not reset by a refresh").toBeLessThanOrEqual(beforeReload + 2);
  expect(afterReload).toBeLessThan(t0);
  const resumed = (await api(page, "GET", `/api/practice-exam/attempts/${attemptId}`)).body;
  expect(resumed.answers.filter((a: any) => a.selectedOption !== null)).toHaveLength(2);
  expect.soft(leaks.filter((l) => l.url.includes("/api/practice-exam")), "no answer keys/correctness while in progress").toEqual([]);

  // Submit from the last question.
  await open(page, `/practice-exam/${attemptId}/15`);
  await page.getByRole("button", { name: /^(Submit|Finish)$/ }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Submit" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForURL(/\/results/, { timeout: 60_000 });

  const checkResults = async () => {
    await expect(page.getByText(/Sample Test Complete/)).toBeVisible();
    await expect(page.getByText(/^(Passed|Not Passed)$/)).toHaveCount(0);
    await expect(page.getByText(/Full-length timed mock exams are included in Pro/)).toBeVisible();
    for (const f of ["All", "Incorrect", "Skipped"]) {
      await expect(page.getByText(new RegExp(String.raw`^${f} \(\d+\)$`)).first()).toBeVisible();
    }
  };
  await checkResults();
  await page.getByText(/^Skipped \(\d+\)$/).first().click();
  await page.reload();
  await checkResults();

  // A second sample (any section) is blocked.
  const second = await api(page, "POST", "/api/practice-exam/start", { section: "FAR" });
  expect(second.status).toBe(402);
  expect(second.body.kind).toBe("sample_test");
  await open(page, "/practice-exam");
  await page.getByRole("button", { name: /^Pro$/ }).first().click();
  await expect(page.getByText("Sample practice test used")).toBeVisible();

  // The section pass flag is untouched by a sample.
  const u = await userRow(ROLE);
  const prog = await one<{ passed: boolean }>("select passed from user_cpa_section_progress where user_id = $1 and passed", [u.id]);
  expect(prog, "no section marked passed by the sample").toBeUndefined();
  const a = await one<{ passed: boolean | null; is_sample: boolean }>(
    "select passed, is_sample from cpa_section_exam_attempts where id = $1",
    [attemptId]
  );
  expect(a!.is_sample).toBe(true);
  test.info().annotations.push({ type: "note", description: `sample attempt row passed=${a!.passed}` });
});

test("A sample test scored 100% still does not mark the section passed", async ({ as }) => {
  const page = await as(ROLE);
  const u = await userRow(ROLE);
  // Allow one more sample for this check only.
  await q("delete from trial_usage where user_id = $1 and kind = 'sample_test'", [u.id]);
  const start = await api(page, "POST", "/api/practice-exam/start", { section: "FAR" });
  expect(start.status, JSON.stringify(start.body).slice(0, 200)).toBe(200);
  const keys = await q<{ id: string; correct_option: number }>(
    "select id, correct_option from problems where id = any($1::uuid[])",
    [start.body.problems.map((p: any) => p.problemId)]
  );
  const key = new Map(keys.map((k) => [k.id, k.correct_option]));
  for (const p of start.body.problems) {
    const r = await api(page, "POST", "/api/practice-exam/answer", {
      attemptId: start.body.attemptId, problemId: p.problemId, module: p.module, orderIndex: p.orderIndex,
      selectedOption: key.get(p.problemId), responseTimeMs: 2000,
    });
    expect(r.status).toBe(200);
  }
  const submit = await api(page, "POST", "/api/practice-exam/submit", { attemptId: start.body.attemptId, totalTimeSeconds: 300 });
  expect(submit.status, JSON.stringify(submit.body).slice(0, 200)).toBe(200);
  const prog = await one<{ passed: boolean }>(
    "select passed from user_cpa_section_progress where user_id = $1 and section = 'FAR'",
    [u.id]
  );
  expect(prog?.passed ?? false, "FAR section pass flag after a perfect sample").toBe(false);
});

test("A daily quest: works, gives XP/streak, does not touch the MCQ counter", async ({ as }) => {
  const page = await as(ROLE);
  const before = await userRow(ROLE);
  const usageBefore = await trialUsage(ROLE);

  let quest = await api(page, "GET", "/api/daily-quest");
  if (quest.status !== 200 || !findProblems(quest.body).length) {
    const gen = await api(page, "POST", "/api/daily-quest/generate");
    expect(gen.status, JSON.stringify(gen.body).slice(0, 200)).toBeLessThan(300);
    quest = await api(page, "GET", "/api/daily-quest");
  }
  expect(quest.status).toBe(200);
  const problems = findProblems(quest.body);
  expect(problems.length).toBeGreaterThan(0);
  for (const p of problems) {
    const r = await api(page, "POST", "/api/daily-quest/answer", { questProblemId: p.id, selectedOption: 0, responseTimeMs: 5000 });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  }
  const questId = quest.body?.quest?.id ?? quest.body?.id ?? quest.body?.questId;
  const done = await api(page, "POST", "/api/daily-quest/complete", { questId, timeElapsedSeconds: 120 });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBeLessThan(300);

  const after = await userRow(ROLE);
  const xp = (r: any) => Number(r.total_xp ?? 0);
  expect(xp(after), "XP awarded").toBeGreaterThan(xp(before));
  expect(Number((after as any).current_streak ?? 0), "streak started").toBeGreaterThanOrEqual(1);
  expect(await trialUsage(ROLE), "quest does not use MCQ quota").toEqual(usageBefore);

  await open(page, "/quest");
  await expect(page).toHaveURL(/\/quest/);
});

test("A AI tutor: quiz + floating tutor answer, counter counts down, cap opens the limit modal", async ({ as }) => {
  const page = await as(ROLE);
  const sub = (await subtopicsOf("aud"))[0];
  const quiz = await api(page, "GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}?mode=quiz`);
  const p = quiz.body.problems[0];
  const remaining = async () => (await api(page, "GET", "/api/trial")).body.tutor.remaining as number;
  const r0 = await remaining();

  const quizTutor = await apiStream(page, "/api/agent/quiz-chat/stream", {
    question: "Why is my answer wrong?", topic: sub.topicSlug, subtopic: sub.subtopicSlug,
    questionText: p.questionText, options: p.options, hint: p.hint ?? "", solutionSteps: p.solutionSteps ?? [],
    // The payload has no key: the route resolves it from problemId.
    problemId: p.id, studentAnswer: 0, history: [], subtopicId: sub.id,
  });
  expect(quizTutor.status, quizTutor.body.slice(0, 200)).toBe(200);
  expect(quizTutor.body.length, "quiz tutor streamed an answer").toBeGreaterThan(20);
  expect(await remaining()).toBe(r0 - 1);

  const floating = await apiStream(page, "/api/agent/chat/stream", {
    question: "Give me one tip for this topic.", lessonTitle: sub.subtopicSlug, lessonContent: p.questionText,
  });
  expect(floating.status, floating.body.slice(0, 200)).toBe(200);
  expect(floating.body.length, "floating tutor streamed an answer").toBeGreaterThan(20);
  expect(await remaining()).toBe(r0 - 2);

  // The quiz tutor page shows the counter.
  await open(page, `/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}/quiz/1/tutor`);
  await expect(page.getByText(new RegExp(`${r0 - 2} of 20 tutor messages left today`))).toBeVisible({ timeout: 60_000 });

  // Force the cap -> 402 + the tutor-limit modal (fired through the app's own fetch wrapper).
  await setTutorUsedToday(ROLE, 20);
  const capped = await api(page, "POST", "/api/agent/chat/stream", { question: "one more", lessonTitle: "x", lessonContent: "x" });
  expect(capped.status).toBe(402);
  expect(capped.body.code).toBe("TRIAL_TUTOR_LIMIT");
  await expect(page.getByText("Daily AI tutor limit reached — unlimited in Pro")).toBeVisible();
});

function findProblems(body: any): { id: string }[] {
  const list = body?.problems ?? body?.quest?.problems ?? body?.questProblems ?? [];
  return Array.isArray(list) ? list.filter((x: any) => x && x.id && !x.answeredAt && x.selectedOption == null) : [];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
