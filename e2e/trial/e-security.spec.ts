// Area E: security spot checks — anon key vs RLS, review API access rules, answer keys in responses.
import { test, expect, api, signIn, type Leak } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { env } from "../lib/env";
import { correctOptions, ensureCustomTopic, quizApi, subtopicsOf, userRow } from "../lib/state";
import type { Page } from "@playwright/test";

test.afterAll(closeDb);

const REST = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

async function rest(method: string, path: string, bearer?: string, body?: unknown) {
  const r = await fetch(`${REST}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${bearer ?? ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const rowsOf = (j: unknown) => (Array.isArray(j) ? j.length : 0);

test("E anon key (and anon + Clerk session token) cannot read keys / other users or change own plan", async ({ as }) => {
  const page = await as("trial");
  const clerkJwt: string | undefined = await page.evaluate(async () => (window as any).Clerk?.session?.getToken());
  const me = await userRow("trial");
  for (const [label, bearer] of [["anon", undefined], ["anon+clerk", clerkJwt]] as const) {
    expect(rowsOf((await rest("GET", "/tbs_answer_keys?select=*", bearer)).json), `${label} tbs_answer_keys`).toBe(0);
    expect(rowsOf((await rest("GET", "/users?select=id,email", bearer)).json), `${label} users`).toBe(0);
    expect(rowsOf((await rest("GET", "/quiz_sessions?select=id", bearer)).json), `${label} quiz_sessions`).toBe(0);
    expect(rowsOf((await rest("GET", "/cpa_section_exam_attempts?select=id", bearer)).json), `${label} attempts`).toBe(0);
    const upd = await rest("PATCH", `/users?id=eq.${me.id}`, bearer, { plan_type: "pro", trial_ends_at: "2099-01-01T00:00:00Z" });
    expect(rowsOf(upd.json), `${label} update own plan`).toBe(0);
  }
  const after = await userRow("trial");
  expect(after.plan_type).toBe(me.plan_type);
  expect(after.trial_ends_at?.getTime()).toBe(me.trial_ends_at?.getTime());
});

test("E review API: in-progress -> 403, another user's attempt -> 404", async ({ as, browser }) => {
  const page = await as("pro");
  const start = await api(page, "POST", "/api/practice-exam/start", { section: "AUD" });
  expect(start.status).toBe(200);
  const id = start.body.attemptId;
  const own = await api(page, "GET", `/api/practice-exam/attempts/${id}/review`);
  expect(own.status).toBe(403);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  const { signIn } = await import("../lib/fixtures");
  await signIn(other, "trial-other");
  expect((await api(other, "GET", `/api/practice-exam/attempts/${id}/review`)).status).toBe(404);
  expect((await api(other, "GET", `/api/practice-exam/attempts/${id}`)).status).toBe(404);
  // A submitted attempt of another user is also 404.
  const done = await q<{ id: string }>(
    "select id from cpa_section_exam_attempts where user_id = $1 and status <> 'in_progress' limit 1",
    [(await userRow("pro")).id]
  );
  if (done[0]) expect((await api(other, "GET", `/api/practice-exam/attempts/${done[0].id}/review`)).status).toBe(404);
  await ctx.close();
});

test("E no answer keys in in-progress responses (quiz, quest, TBS, exam)", async ({ as, leaks }) => {
  const page: Page = await as("trial-other");
  const sub = (await subtopicsOf("aud"))[0];
  const quiz = await api(page, "GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}?mode=quiz`);
  // No key, solution or hints (option hints name every wrong option) before answering.
  const REVEAL = ["correctOption", "explanation", "solutionSteps", "hint", "detailedHint", "optionHints"];
  const quizFields = (quiz.body.problems ?? []).flatMap((p: any) => REVEAL.filter((k) => k in p));
  expect(quizFields, "MCQ quiz reveal fields").toEqual([]);
  let quest = await api(page, "GET", "/api/daily-quest");
  if (!quest.body?.problems?.length) {
    await api(page, "POST", "/api/daily-quest/generate");
    quest = await api(page, "GET", "/api/daily-quest");
  }
  const questFields = ((quest.body?.problems ?? []) as any[])
    .filter((p) => p.selectedOption === null)
    .flatMap((p) => REVEAL.filter((k) => k in p));
  expect(questFields, "quest reveal fields (unanswered)").toEqual([]);
  const tasks = (await api(page, "GET", "/api/tbs?section=aud")).body.tasks as any[];
  await api(page, "GET", `/api/tbs/${tasks.find((t) => t.isSample).id}`);
  const ex = await api(page, "POST", "/api/practice-exam/start", { section: "AUD" });
  if (ex.status === 200) await api(page, "GET", `/api/practice-exam/attempts/${ex.body.attemptId}`);
  await page.waitForTimeout(1000);
  const byArea = (re: RegExp) => leaks.filter((l: Leak) => re.test(l.url));
  expect(byArea(/\/api\/tbs/), "TBS").toEqual([]);
  expect(byArea(/\/api\/practice-exam/), "exam").toEqual([]);
  expect(byArea(/\/api\/learning\/[^/]+\/[^/]+\?/), "MCQ quiz payload").toEqual([]);
  expect(byArea(/\/api\/daily-quest/), "quest payload").toEqual([]);
});

test("E custom topics: no answers before answering, revealed after", async ({ as, leaks, browser }) => {
  const page: Page = await as("pro");
  const topicId = await ensureCustomTopic("pro", (await subtopicsOf("aud"))[0]);
  const res = await api(page, "GET", `/api/my-learning/topics/${topicId}`);
  expect(res.status).toBe(200);
  const questions = res.body.questions as any[];
  expect(questions.length).toBeGreaterThan(0);
  const REVEAL = ["correctOption", "explanation", "solutionSteps", "hint", "optionHints"];
  expect(questions.flatMap((p) => REVEAL.filter((k) => k in p)), "custom reveal fields").toEqual([]);
  expect(leaks.filter((l: Leak) => /\/api\/my-learning\/topics/.test(l.url)), "custom payload").toEqual([]);

  const fb = await api(page, "POST", "/api/my-learning/quiz/answer", { topicId, questionId: questions[0].id, selectedOption: 0 });
  expect(fb.status).toBe(200);
  expect(typeof fb.body.isCorrect).toBe("boolean");
  expect(fb.body.correctOption).toBeGreaterThanOrEqual(0);
  expect(typeof fb.body.explanation).toBe("string");
  // Owner check: another user can't grade (or read) this topic.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  const { signIn } = await import("../lib/fixtures");
  await signIn(other, "pro-annual");
  // 404 when that account is Pro; 402 (Pro-only API) when it isn't — either way no answers.
  expect([402, 404]).toContain((await api(other, "POST", "/api/my-learning/quiz/answer", { topicId, questionId: questions[0].id, selectedOption: 0 })).status);
  expect([402, 404]).toContain((await api(other, "GET", `/api/my-learning/topics/${topicId}`)).status);
  await ctx.close();
});

test("E custom practice problems: no answer keys before answering, graded per answer, owner only", async ({ as, leaks, browser }) => {
  const page: Page = await as("pro");
  const topicId = await ensureCustomTopic("pro", (await subtopicsOf("aud"))[0]);
  const url = `/api/my-learning/topics/${topicId}/practice-problems`;
  const res = await api(page, "GET", url);
  expect(res.status).toBe(200);
  const problems = res.body.problems as any[];
  expect(problems.length).toBeGreaterThan(0);
  const REVEAL = ["correctOption", "explanation", "solutionSteps", "optionHints"];
  expect(problems.flatMap((p) => REVEAL.filter((k) => k in p)), "practice reveal fields").toEqual([]);
  expect(problems.filter((p) => p.hint || p.detailedHint), "practice hints").toEqual([]);
  expect(leaks.filter((l: Leak) => l.url.endsWith("/practice-problems")), "practice payload").toEqual([]);

  const p0 = problems[0];
  const key = (await correctOptions([p0.id])).get(p0.id)!;
  const wrong = await api(page, "POST", url, { problemId: p0.id, selectedOption: (key + 1) % p0.options.length, reveal: false });
  expect(wrong.status).toBe(200);
  expect(wrong.body.isCorrect).toBe(false);
  expect(wrong.body.answer, "no key on a non-final miss").toBeUndefined();
  const right = await api(page, "POST", url, { problemId: p0.id, selectedOption: key, reveal: false });
  expect(right.body.isCorrect).toBe(true);
  expect(right.body.answer.correctOption).toBe(key);
  expect(typeof right.body.answer.explanation).toBe("string");

  // Another account can't read or grade this topic's practice (404 if Pro, 402 if not).
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, "pro-annual");
  expect([402, 404]).toContain((await api(other, "GET", url)).status);
  expect([402, 404]).toContain((await api(other, "POST", url, { problemId: p0.id, selectedOption: key })).status);
  await ctx.close();
});

test("E quiz submit: a fake score is ignored, the server-calculated score is returned", async ({ as }) => {
  const page: Page = await as("pro");
  // Custom topic quiz: every answer wrong, but claim a perfect score.
  const topicId = await ensureCustomTopic("pro", (await subtopicsOf("aud"))[0]);
  const questions = (await api(page, "GET", `/api/my-learning/topics/${topicId}`)).body.questions as any[];
  const keys = await correctOptions(questions.map((x) => x.id));
  const custom = await api(page, "POST", "/api/my-learning/quiz/submit", {
    topicId, score: 999, totalQuestions: 1, timeElapsedSeconds: 30,
    answers: questions.map((x) => ({ questionId: x.id, selectedOption: (keys.get(x.id)! + 1) % x.options.length, isCorrect: true })),
  });
  expect(custom.status).toBe(200);
  expect(custom.body.score, "custom score").toBe(0);
  expect(custom.body.totalQuestions).toBe(questions.length);
  expect(Object.keys(custom.body.reveals ?? {}).length, "review answers").toBe(questions.length);

  // Subtopic quiz: same check against act-quiz/submit.
  const sub = (await subtopicsOf("aud"))[0];
  const quiz = (await api(page, "GET", quizApi(sub))).body.problems as any[];
  const qkeys = await correctOptions(quiz.map((x) => x.id));
  const cpa = await api(page, "POST", "/api/act-quiz/submit", {
    subtopicId: sub.id, score: 999, totalQuestions: quiz.length, timeElapsedSeconds: 60,
    answers: quiz.map((x) => ({ problemId: x.id, selectedOption: (qkeys.get(x.id)! + 1) % x.options.length, isCorrect: true })),
  });
  expect(cpa.status).toBe(200);
  expect(cpa.body.score, "subtopic quiz score").toBe(0);
});
