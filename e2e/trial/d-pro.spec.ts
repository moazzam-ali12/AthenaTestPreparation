// Area D: Pro user — no limits, 90-minute mock exam with pass logic, review, mentor, no tutor cap,
// micro-lesson redirect after 2 practice misses.
import { test, expect, api, apiStream, open } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { setTutorUsedToday, subtopicsOf, userRow, ensurePracticeProblems } from "../lib/state";
import { missTwiceInPractice, clickLog } from "../lib/flows";

const ROLE = "pro" as const;
test.beforeAll(async () => {
  const u = await userRow(ROLE);
  if (u.subscription_status !== "active") throw new Error("run c-upgrade.spec.ts first (pro account not subscribed)");
  await q("delete from cpa_section_exam_answers where attempt_id in (select id from cpa_section_exam_attempts where user_id = $1 and status = 'in_progress')", [u.id]);
  await q("delete from cpa_section_exam_attempts where user_id = $1 and status = 'in_progress'", [u.id]);
  await ensurePracticeProblems((await subtopicsOf("aud"))[0]);
});
test.afterAll(closeDb);

test("D no limits: quiz, TBS, tier", async ({ as }) => {
  const page = await as(ROLE);
  expect((await api(page, "GET", "/api/trial")).body.tier).toBe("pro");
  await open(page, "/dashboard");
  await expect(page.getByText(/Free trial:/)).toHaveCount(0);
  const sub = (await subtopicsOf("aud"))[0];
  const quiz = await api(page, "GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}?mode=quiz`);
  expect(quiz.status, JSON.stringify(quiz.body).slice(0, 200)).toBe(200);
  expect(quiz.body.problems.length).toBeGreaterThan(10);
  const tasks = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as any[];
  expect(tasks.every((t) => !t.locked)).toBe(true);
  for (const t of tasks.slice(0, 3)) expect((await api(page, "GET", `/api/tbs/${t.id}`)).status, t.id).toBe(200);
});

test("D full mock exam: 90-minute timer, pass logic, review", async ({ as }) => {
  const page = await as(ROLE);
  const start = await api(page, "POST", "/api/practice-exam/start", { section: "REG" });
  expect(start.status, JSON.stringify(start.body).slice(0, 200)).toBe(200);
  expect(start.body.isSample).toBe(false);
  expect(start.body.durationMinutes).toBe(90);
  expect(start.body.problems.length).toBeGreaterThan(15);

  await open(page, `/practice-exam/${start.body.attemptId}/1`);
  const t = await page.getByText(/^\d{1,2}:\d{2}$/).first().textContent();
  const [m] = t!.split(":").map(Number);
  expect(m, `timer ${t}`).toBeGreaterThanOrEqual(89);

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
  await expect(page.getByText(/^Incorrect \(\d+\)$/).first()).toBeVisible();
  expect((await api(page, "GET", `/api/practice-exam/attempts/${start.body.attemptId}/review`)).status).toBe(200);
  const u = await userRow(ROLE);
  const prog = await q<{ passed: boolean }>("select passed from user_cpa_section_progress where user_id = $1 and section = 'REG'", [u.id]);
  expect(prog[0]?.passed, "REG marked passed after a passing full mock").toBe(true);
});

test("D mentor opens, no tutor cap", async ({ as }) => {
  const page = await as(ROLE);
  await open(page, "/mentor");
  await expect(page).toHaveURL(/\/mentor$/);
  await setTutorUsedToday(ROLE, 25);
  const r = await apiStream(page, "/api/agent/chat/stream", { question: "One tip on independence?", lessonTitle: "x", lessonContent: "x" });
  expect(r.status, r.body.slice(0, 200)).toBe(200);
  await open(page, "/learning");
  await expect(page.getByText(/tutor messages left today/)).toHaveCount(0);
});

test("D 2 practice misses redirect to the micro-lesson", async ({ as }) => {
  const page = await as(ROLE);
  await missTwiceInPractice(page, (await subtopicsOf("aud"))[0]);
  await expect(page).toHaveURL(/\/micro-lesson$/, { timeout: 30_000 });
  expect(clickLog, "answer revealed after the 2nd miss").toContain("revealed");
  expect(clickLog, "revealed answer never marked correct").not.toContain("FALSE-CORRECT");
});
