import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySectionProgress,
  attemptElapsedSeconds,
  buildAttemptReview,
  reviewAccess,
  examDurationMinutes,
  ownedAttempt,
  redactProblem,
  startOrResumeAttempt,
} from "./practice-exam";
import { SAMPLE_TEST_MINUTES, SAMPLE_TEST_MINUTES_PER_QUESTION, SAMPLE_TEST_QUESTIONS } from "./trial";
import { SECTION_TIME_LIMIT_SECONDS } from "../types/cpa-exam";

test("sample attempt skips the section pass/progress update, even with a passing score", async () => {
  let calls = 0;
  const updated = await applySectionProgress({ isSample: true }, 99, true, async () => {
    calls++;
  });
  assert.equal(updated, false);
  assert.equal(calls, 0);
});

test("full attempt updates section progress with its score and pass flag", async () => {
  const seen: [number, boolean][] = [];
  const updated = await applySectionProgress({ isSample: false }, 80, true, async (s, p) => {
    seen.push([s, p]);
  });
  assert.equal(updated, true);
  assert.deepEqual(seen, [[80, true]]);
});

test("sample duration derives from question count; full exam keeps its limit", () => {
  assert.equal(SAMPLE_TEST_MINUTES, Math.ceil(SAMPLE_TEST_QUESTIONS * SAMPLE_TEST_MINUTES_PER_QUESTION));
  assert.equal(examDurationMinutes({ isSample: true }), SAMPLE_TEST_MINUTES);
  assert.equal(examDurationMinutes({ isSample: false }), SECTION_TIME_LIMIT_SECONDS / 60);
});

// ── /start idempotency ──
function startHarness(opts: { inProgress: { id: string } | null; sample: boolean; quotaLeft: number }) {
  const calls = { consume: 0, create: 0, prepare: 0 };
  let quota = opts.quotaLeft;
  let inProgress = opts.inProgress;
  const run = () =>
    startOrResumeAttempt({
      sample: opts.sample,
      findInProgress: async () => inProgress,
      prepare: async () => {
        calls.prepare++;
        return { ok: true as const, value: "test-1" };
      },
      consumeSampleQuota: async () => {
        calls.consume++;
        if (quota <= 0) return false;
        quota--;
        return true;
      },
      create: async () => {
        calls.create++;
        inProgress = { id: `attempt-${calls.create}` };
        return inProgress;
      },
    });
  return { run, calls };
}

test("start resumes an in-progress attempt without consuming quota or creating a row", async () => {
  const { run, calls } = startHarness({ inProgress: { id: "a1" }, sample: true, quotaLeft: 0 });
  const outcome = await run();
  assert.deepEqual(outcome, { kind: "resumed", attempt: { id: "a1" } });
  assert.deepEqual(calls, { consume: 0, create: 0, prepare: 0 });
});

test("repeated sample starts consume the quota exactly once (refresh-safe)", async () => {
  const { run, calls } = startHarness({ inProgress: null, sample: true, quotaLeft: 1 });
  const first = await run();
  const second = await run();
  const third = await run();
  assert.equal(first.kind, "created");
  assert.equal(second.kind, "resumed");
  assert.equal(third.kind, "resumed");
  assert.equal(calls.consume, 1);
  assert.equal(calls.create, 1);
});

test("sample start with no quota left creates nothing", async () => {
  const { run, calls } = startHarness({ inProgress: null, sample: true, quotaLeft: 0 });
  assert.deepEqual(await run(), { kind: "limit" });
  assert.equal(calls.create, 0);
});

test("full (Pro) start never touches the sample quota", async () => {
  const { run, calls } = startHarness({ inProgress: null, sample: false, quotaLeft: 0 });
  assert.equal((await run()).kind, "created");
  assert.equal(calls.consume, 0);
});

test("start validation error consumes no quota", async () => {
  let consumed = 0;
  const outcome = await startOrResumeAttempt({
    sample: true,
    findInProgress: async () => null,
    prepare: async () => ({ ok: false as const, error: "no exam" }),
    consumeSampleQuota: async () => (consumed++, true),
    create: async () => ({ id: "x" }),
  });
  assert.deepEqual(outcome, { kind: "error", error: "no exam" });
  assert.equal(consumed, 0);
});

// ── Attempt lookup ──
test("owner check: another user's attempt is treated as not found", () => {
  const attempt = { id: "a1", userId: "user-1" };
  assert.equal(ownedAttempt(attempt, "user-1"), attempt);
  assert.equal(ownedAttempt(attempt, "user-2"), null);
  assert.equal(ownedAttempt(null, "user-1"), null);
});

test("elapsed time comes from started_at and is clamped to the time limit", () => {
  const start = "2026-11-11T12:00:00Z";
  const at = (s: number) => Date.parse(start) + s * 1000;
  assert.equal(attemptElapsedSeconds(start, 24, at(300)), 300);
  assert.equal(attemptElapsedSeconds(start, 24, at(99_999)), 24 * 60);
  assert.equal(attemptElapsedSeconds(start, 24, at(-10)), 0);
});

test("in-progress problems are served without answer keys", () => {
  const p = redactProblem({ correctOption: 2, explanation: "why", solutionSteps: [{ step: 1 }], detailedHint: "h", questionText: "Q" });
  assert.equal(p.correctOption, -1);
  assert.equal(p.explanation, "");
  assert.deepEqual(p.solutionSteps, []);
  assert.equal(p.detailedHint, undefined);
  assert.equal(p.questionText, "Q");
});

// ── Answer review ──
const reviewProblems = [
  { problemId: "p1", questionText: "Q1?", options: ["a", "b", "c", "d"], correctOption: 1, explanation: "E1", solutionSteps: [{ step: 1, instruction: "do" }], subtopicId: "s1", difficulty: "easy" },
  { problemId: "p2", questionText: "Q2?", options: ["a", "b", "c", "d"], correctOption: 2, explanation: "E2", solutionSteps: [], subtopicId: "s2", difficulty: "hard" },
  { problemId: "p3", questionText: "Q3?", options: ["a", "b", "c", "d"], correctOption: 0, explanation: "E3", solutionSteps: [], subtopicId: "s1", difficulty: "medium" },
  // Part of the exam but not in this (sample) attempt — must not appear.
  { problemId: "p9", questionText: "Q9?", options: ["a"], correctOption: 0, explanation: "", solutionSteps: [], subtopicId: "s1", difficulty: "easy" },
];
const reviewAnswers = [
  { problemId: "p3", module: 2, orderIndex: 0, selectedOption: null },
  { problemId: "p1", module: 1, orderIndex: 0, selectedOption: 1 },
  { problemId: "p2", module: 1, orderIndex: 1, selectedOption: 0 },
];
const names = new Map([["s1", "Revenue"], ["s2", "Leases"]]);

test("review: in-progress attempt is refused with 403 ATTEMPT_NOT_SUBMITTED (no keys returned)", () => {
  const attempt = { id: "a1", userId: "u1", status: "in_progress" };
  assert.deepEqual(reviewAccess(attempt, "u1"), { status: 403, code: "ATTEMPT_NOT_SUBMITTED" });
  const result = buildAttemptReview(attempt, "u1", reviewAnswers, reviewProblems, names);
  assert.equal(result.status, 403);
  assert.ok(!("body" in result));
});

test("review: another user's attempt (or a missing one) is 404", () => {
  const attempt = { id: "a1", userId: "u1", status: "completed" };
  assert.deepEqual(reviewAccess(attempt, "u2"), { status: 404 });
  assert.deepEqual(reviewAccess(null, "u1"), { status: 404 });
  assert.equal(buildAttemptReview(attempt, "u2", reviewAnswers, reviewProblems, names).status, 404);
});

test("review: submitted attempt returns every stored question in exam order with keys", () => {
  const result = buildAttemptReview({ id: "a1", userId: "u1", status: "completed" }, "u1", reviewAnswers, reviewProblems, names);
  assert.equal(result.status, 200);
  if (result.status !== 200) return;
  assert.equal(result.body.attemptId, "a1");
  assert.deepEqual(result.body.questions.map((q) => [q.number, q.id, q.userAnswer, q.correctAnswer, q.isCorrect]), [
    [1, "p1", 1, 1, true],
    [2, "p2", 0, 2, false],
    [3, "p3", null, 0, false],
  ]);
  assert.deepEqual(result.body.questions[0], {
    id: "p1",
    number: 1,
    stem: "Q1?",
    options: ["a", "b", "c", "d"],
    userAnswer: 1,
    correctAnswer: 1,
    isCorrect: true,
    explanation: "E1",
    solutionSteps: [{ step: 1, instruction: "do" }],
    subtopicName: "Revenue",
    difficulty: "easy",
  });
});
