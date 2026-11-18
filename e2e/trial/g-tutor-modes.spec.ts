// Area G: quiz tutor modes (Hint / Guided / Full explanation) + "Why was I wrong?".
// Needs the agents service started with AGENT_MOCK_LLM=1: the mock tutor deliberately states the
// correct option in every mode, so these checks prove the SERVER guard (not the prompt) hides it.
import { test, expect, api, apiStream, open } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { correctOptions, ensurePracticeProblems, quizApi, quizPath, setTutorUsedToday, subtopicsOf, userId, type SubtopicRef } from "../lib/state";
import type { Page } from "@playwright/test";

const ROLE = "pro" as const;
const HIDDEN = "[hidden until you answer]";
const STREAM = "/api/agent/quiz-chat/stream";

let sub: SubtopicRef;
test.beforeAll(async () => {
  sub = (await subtopicsOf("aud"))[0];
  await ensurePracticeProblems(sub);
});
test.afterAll(closeDb);

/** Concatenated `token` events + any trailing practice links of an SSE body. */
function parseSse(body: string) {
  let text = "";
  let links: { id: string; label: string; href: string }[] | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    try {
      const ev = JSON.parse(line.slice(6));
      if (typeof ev.token === "string") text += ev.token;
      if (Array.isArray(ev.practice_links)) links = ev.practice_links;
    } catch {}
  }
  return { text, links };
}

async function firstProblem(page: Page) {
  const p = (await api(page, "GET", quizApi(sub))).body.problems[0];
  const key = (await correctOptions([p.id])).get(p.id)!;
  return { p, key, letter: String.fromCharCode(65 + key), wrong: (key + 1) % p.options.length };
}

function ask(page: Page, p: any, mode: string, studentAnswer?: number) {
  return apiStream(page, STREAM, {
    question: "Help me with this one.", topic: sub.topicSlug, subtopic: sub.subtopicSlug,
    questionText: p.questionText, options: p.options, hint: p.hint ?? "", solutionSteps: [],
    problemId: p.id, studentAnswer, history: [], subtopicId: sub.id, mode,
  });
}

test("G before answering, no mode returns the correct option", async ({ as }) => {
  const page = await as(ROLE);
  const { p, key, letter } = await firstProblem(page);
  for (const mode of ["hint", "guided", "full"]) {
    const res = await ask(page, p, mode);
    expect(res.status, res.body.slice(0, 200)).toBe(200);
    const { text } = parseSse(res.body);
    test.skip(!text.includes("[mock:"), "agents service is not running with AGENT_MOCK_LLM=1");
    expect(text, `${mode} answers in its own mode`).toContain(`[mock:${mode}]`);
    expect(text, `${mode} redacts the key`).toContain(HIDDEN);
    expect(text).not.toContain(`option ${letter}`);
    expect(text).not.toContain(p.options[key]);
  }
  // A client-sent wrong key cannot redirect the guard: the server's key wins.
  const spoof = parseSse((await apiStream(page, STREAM, {
    question: "x", topic: sub.topicSlug, subtopic: sub.subtopicSlug, questionText: p.questionText, options: p.options,
    hint: "", solutionSteps: [], problemId: p.id, correctOption: (key + 1) % p.options.length, mode: "full",
  })).body).text;
  expect(spoof).not.toContain(`option ${letter}`);
  // "Why was I wrong?" needs a wrong answer first.
  expect((await ask(page, p, "why_wrong")).status).toBe(400);
});

test("G after answering: Full explains, Why was I wrong? names the choice + 2 practice links", async ({ as }) => {
  const page = await as(ROLE);
  const { p, key, letter, wrong } = await firstProblem(page);

  const full = parseSse((await ask(page, p, "full", wrong)).body).text;
  test.skip(!full.includes("[mock:"), "agents service is not running with AGENT_MOCK_LLM=1");
  expect(full).toContain(`option ${letter}: ${p.options[key]}`);

  expect((await ask(page, p, "why_wrong", key)).status, "right answer → nothing to analyse").toBe(400);
  const why = await ask(page, p, "why_wrong", wrong);
  expect(why.status).toBe(200);
  const { text, links } = parseSse(why.body);
  expect(text).toContain("[mock:why_wrong]");
  expect(text, "references the chosen option").toContain(`option ${String.fromCharCode(65 + wrong)}: ${p.options[wrong]}`);
  expect(links?.length, "2 follow-up practice links").toBe(2);
  for (const l of links!) {
    expect(l.href).toMatch(/^\/learning\/[^/]+\/[^/]+\/practice\?ids=[0-9a-f-]{36}$/);
    const ids = new URL(l.href, "http://x").searchParams.get("ids");
    const served = await api(page, "GET", `/api/learning/${encodeURIComponent(sub.topicSlug)}/${encodeURIComponent(sub.subtopicSlug)}/practice-problems?ids=${ids}`);
    expect(served.body.problems.map((x: any) => x.id)).toEqual([ids]);
  }
});

test("G each mode message counts toward the trial tutor cap", async ({ as }) => {
  const page = await as("trial");
  await setTutorUsedToday("trial", 0);
  const remaining = async () => (await api(page, "GET", "/api/trial")).body?.tutor?.remaining as number | undefined;
  const r0 = await remaining();
  test.skip(typeof r0 !== "number", "tutor cap is off in this trial mode");
  const { p, wrong } = await firstProblem(page);
  for (const [mode, ans] of [["hint", undefined], ["guided", undefined], ["full", undefined], ["why_wrong", wrong]] as const) {
    expect((await ask(page, p, mode, ans)).status).toBe(200);
  }
  expect(await remaining()).toBe(r0! - 4);
  await setTutorUsedToday("trial", 0);
});

test("G mode selector: Hint by default, the user's choice is remembered", async ({ as }) => {
  const page = await as(ROLE);
  await q("update user_preferences set tutor_mode = null where user_id = $1", [await userId(ROLE)]);
  await open(page, `${quizPath(sub)}/tutor`);
  const group = page.getByRole("radiogroup", { name: "Tutor mode" });
  await expect(group).toBeVisible({ timeout: 60_000 });
  await expect(group.getByRole("radio", { name: "Hint" })).toHaveAttribute("aria-checked", "true");

  await group.getByRole("radio", { name: "Guided" }).click();
  await expect(group.getByRole("radio", { name: "Guided" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await api(page, "GET", "/api/tutor-preferences")).body.tutorMode).toBe("guided");

  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Tutor mode" }).getByRole("radio", { name: "Guided" }))
    .toHaveAttribute("aria-checked", "true", { timeout: 60_000 });
  await q("update user_preferences set tutor_mode = null where user_id = $1", [await userId(ROLE)]);
});
