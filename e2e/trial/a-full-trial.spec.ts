// Area A (full trial): a trial user gets every Pro feature for 7 days — no quotas, no sample
// test, no upgrade modal. Only the AI-tutor cost guard (100 messages/day) applies.
import { test, expect, api, apiStream, open, signIn } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { TRIAL_MODE } from "../lib/env";
import {
  resetToFreshTrial, setTrialEndsIn, setTutorUsedToday, subtopicsOf, quizApi, trialUsage, userRow,
  ensurePracticeProblems,
} from "../lib/state";
import { missTwiceInPractice } from "../lib/flows";

test.skip(TRIAL_MODE !== "full", "full-trial spec; the app runs the limited trial");

const ROLE = "trial" as const;
const SECTIONS = ["aud", "far", "reg", "bar", "isc", "tcp"] as const;
const UPGRADE_TEXT = /This is a Pro feature|You've used your free questions|Sample simulation used|Sample practice test used/;

test.beforeAll(async () => {
  await resetToFreshTrial(ROLE);
  await resetToFreshTrial("trial-lastday");
  await setTrialEndsIn("trial-lastday", "12 hours");
  await ensurePracticeProblems((await subtopicsOf("aud"))[0]);
});
test.afterAll(closeDb);

test("A full: banner shows full access + days left, last-day copy, no feature list", async ({ as, browser }) => {
  const page = await as(ROLE);
  await open(page, "/dashboard");
  await expect(page.getByText(/Free trial — full access · [67] days left/)).toBeVisible();
  await expect(page.getByTestId("trial-banner").getByRole("link", { name: "View Plans" })).toBeVisible();
  await expect(page.getByText(/Unlimited practice quizzes across every section/)).toHaveCount(0);
  await expect(page.getByText(/Included in your free trial/)).toHaveCount(0);

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await signIn(p2, "trial-lastday");
  await open(p2, "/dashboard");
  await expect(p2.getByText("Your free trial ends today — subscribe to keep your streak and progress.")).toBeVisible();
  await ctx.close();
});

test("A full: every section, no counters, unlimited MCQs, nothing counted", async ({ as }) => {
  const page = await as(ROLE);
  await open(page, "/learning");
  await expect(page.getByText(/free questions used/i)).toHaveCount(0);
  for (const s of SECTIONS) {
    const quiz = await api(page, "GET", quizApi((await subtopicsOf(s))[0]));
    expect(quiz.status, `first ${s} quiz`).toBe(200);
  }
  // A full quiz (not capped at 10), and >10 distinct answers in one section all succeed.
  const aud = await subtopicsOf("aud");
  const quiz = (await api(page, "GET", quizApi(aud[0]))).body;
  expect(quiz.problems.length, "no 10-question trial cap").toBeGreaterThan(10);
  for (const p of quiz.problems.slice(0, 12)) {
    const r = await api(page, "POST", "/api/act-quiz/answer", { problemId: p.id, selectedOption: 0 });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  }
  expect(await trialUsage(ROLE), "no trial quota consumed").toEqual([]);
  const usage = (await api(page, "GET", "/api/trial")).body;
  expect(usage.tier).toBe("trial");
  expect(usage.usage).toEqual({ mcq: {}, tbs: {}, sampleTests: 0 });
});

test("A full: every TBS opens, none locked, no 'Free sample' copy", async ({ as }) => {
  const page = await as(ROLE);
  const tasks = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as any[];
  expect(tasks.length).toBeGreaterThan(1);
  expect(tasks.every((t) => !t.locked)).toBe(true);
  for (const t of tasks.slice(0, 3)) expect((await api(page, "GET", `/api/tbs/${t.id}`)).status, t.id).toBe(200);
  await open(page, "/learning");
  await page.getByRole("button", { name: /^AUD/ }).first().click();
  await expect(page.getByText(tasks[0].title).first()).toBeVisible();
  await expect(page.getByText(/Free sample|sample simulation per section/)).toHaveCount(0);
  expect(await trialUsage(ROLE)).toEqual([]);
});

test("A full: mentor, micro-lessons, My Learning, review, queue — open, no modal", async ({ as }) => {
  const page = await as(ROLE);
  const sub = (await subtopicsOf("aud"))[0];
  const subPath = `${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}`;
  for (const path of ["/mentor", `/learning/${subPath}/micro-lesson`, "/my-learning", "/review", "/queue", "/progress", "/practice-exam"]) {
    await open(page, path);
    await expect(page, path).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByText(UPGRADE_TEXT), `no upgrade modal on ${path}`).toHaveCount(0);
  }
  for (const url of [`/api/learning/${subPath}/micro-lesson`, "/api/my-learning/topics"]) {
    expect((await api(page, "GET", url)).status, url).not.toBe(402);
  }
});

test("A full: full-length mock exam with normal pass logic (no sample)", async ({ as }) => {
  const page = await as(ROLE);
  const start = await api(page, "POST", "/api/practice-exam/start", { section: "REG" });
  expect(start.status, JSON.stringify(start.body).slice(0, 200)).toBe(200);
  expect(start.body.isSample).toBe(false);
  expect(start.body.durationMinutes).toBe(90);
  expect(start.body.problems.length).toBeGreaterThan(15);

  const keys = await q<{ id: string; correct_option: number }>(
    "select id, correct_option from problems where id = any($1::uuid[])",
    [start.body.problems.map((p: any) => p.problemId)]
  );
  const key = new Map(keys.map((k) => [k.id, k.correct_option]));
  for (const p of start.body.problems) {
    await api(page, "POST", "/api/practice-exam/answer", {
      attemptId: start.body.attemptId, problemId: p.problemId, module: p.module, orderIndex: p.orderIndex,
      selectedOption: key.get(p.problemId),
    });
  }
  const submit = await api(page, "POST", "/api/practice-exam/submit", { attemptId: start.body.attemptId, totalTimeSeconds: 1800 });
  expect(submit.status).toBe(200);
  await open(page, `/practice-exam/${start.body.attemptId}/results`);
  await expect(page.getByText(/REG Practice Exam Complete/)).toBeVisible();
  await expect(page.getByText(/^Passed$/)).toBeVisible();
  await expect(page.getByText(/Full-length timed mock exams are included in Pro/)).toHaveCount(0);
  const u = await userRow(ROLE);
  const prog = await q<{ passed: boolean }>("select passed from user_cpa_section_progress where user_id = $1 and section = 'REG'", [u.id]);
  expect(prog[0]?.passed, "REG marked passed after a passing full mock").toBe(true);
  expect(await trialUsage(ROLE), "no sample_test consumed").toEqual([]);
});

test("A full: daily quest gives XP + streak", async ({ as }) => {
  const page = await as(ROLE);
  const before = await userRow(ROLE);
  let quest = await api(page, "GET", "/api/daily-quest");
  const problems = () => ((quest.body?.problems ?? quest.body?.quest?.problems ?? []) as any[]).filter((p) => p.selectedOption == null);
  if (quest.status !== 200 || !problems().length) {
    const gen = await api(page, "POST", "/api/daily-quest/generate");
    expect(gen.status, JSON.stringify(gen.body).slice(0, 200)).toBeLessThan(300);
    quest = await api(page, "GET", "/api/daily-quest");
  }
  for (const p of problems()) {
    const r = await api(page, "POST", "/api/daily-quest/answer", { questProblemId: p.id, selectedOption: 0, responseTimeMs: 5000 });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  }
  const questId = quest.body?.quest?.id ?? quest.body?.id;
  const done = await api(page, "POST", "/api/daily-quest/complete", { questId, timeElapsedSeconds: 120 });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBeLessThan(300);
  const after = await userRow(ROLE);
  expect(Number((after as any).total_xp ?? 0)).toBeGreaterThan(Number((before as any).total_xp ?? 0));
  expect(Number((after as any).current_streak ?? 0)).toBeGreaterThanOrEqual(1);
});

test("A full: AI tutor works with no visible counter; 100/day cost guard", async ({ as }) => {
  const page = await as(ROLE);
  const sub = (await subtopicsOf("aud"))[0];
  const r = await apiStream(page, "/api/agent/chat/stream", { question: "One tip on independence?", lessonTitle: "x", lessonContent: "x" });
  expect(r.status, r.body.slice(0, 200)).toBe(200);
  expect(r.body.length).toBeGreaterThan(20);
  await open(page, `/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}/quiz/1/tutor`);
  await expect(page.getByText(/tutor messages left today/)).toHaveCount(0);

  // 20 (the limited-trial cap) is no limit any more; 100 is.
  await setTutorUsedToday(ROLE, 25);
  const ok = await apiStream(page, "/api/agent/chat/stream", { question: "Another tip?", lessonTitle: "x", lessonContent: "x" });
  expect(ok.status, ok.body.slice(0, 200)).toBe(200);
  await setTutorUsedToday(ROLE, 100);
  const capped = await api(page, "POST", "/api/agent/chat/stream", { question: "one more", lessonTitle: "x", lessonContent: "x" });
  expect(capped.status).toBe(402);
  expect(capped.body.code).toBe("TRIAL_TUTOR_LIMIT");
  await setTutorUsedToday(ROLE, 0);
});

test("A full: 2 practice misses redirect to the micro-lesson, like Pro", async ({ as }) => {
  const page = await as(ROLE);
  await missTwiceInPractice(page, (await subtopicsOf("aud"))[0]);
  await expect(page).toHaveURL(/\/micro-lesson$/, { timeout: 30_000 });
});
