import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardReducer,
  gradeLocally,
  initialCardState,
  isFinalMiss,
  type CardEvent,
  type CardState,
} from "./practice-card-machine";
import { gradePracticeAnswer, toPublicPracticeProblem, type PracticeRow } from "../../lib/practice-grading";

const problem = { correctOption: 2, explanation: "Because C.", solutionSteps: [], conceptTags: ["x"] };
const run = (events: CardEvent[], from: CardState = initialCardState) => events.reduce(cardReducer, from);
const miss = (option: number): CardEvent[] => [{ type: "submit", option }, gradeLocally(problem, option)];

test("2 misses: answering -> hinted -> revealed -> exhausted, never correct", () => {
  const afterOne = run(miss(0));
  assert.equal(afterOne.status, "hinted");
  assert.equal(isFinalMiss(afterOne), true, "second miss must ask the server to reveal");

  const revealed = run(miss(1), afterOne);
  assert.equal(revealed.status, "revealed");
  assert.equal(revealed.answer?.correctOption, 2, "answer is shown");
  assert.deepEqual(revealed.wrong, [0, 1]);
  assert.notEqual(revealed.selected, 2, "revealed answer is not the user's selection");

  // Clicking the revealed correct option does nothing.
  assert.equal(run([{ type: "submit", option: 2 }], revealed), revealed);

  const exhausted = run([{ type: "advance" }], revealed);
  assert.equal(exhausted.status, "exhausted");
  // A second advance (timer + "Got it" click) cannot re-fire or turn into "done".
  assert.equal(run([{ type: "advance" }], exhausted).status, "exhausted");
});

test("correct answer -> correct -> done", () => {
  const s = run([{ type: "submit", option: 2 }, gradeLocally(problem, 2), { type: "advance" }]);
  assert.equal(s.status, "done");
});

test("correct after one miss still counts as correct", () => {
  const s = run([...miss(0), { type: "submit", option: 2 }, gradeLocally(problem, 2)]);
  assert.equal(s.status, "correct");
});

test("failed server grade returns to the previous state without counting a miss", () => {
  const s = run([...miss(0), { type: "submit", option: 1 }, { type: "gradeFailed" }]);
  assert.equal(s.status, "hinted");
  assert.equal(s.misses, 1);
});

test("stale grade for a different option is ignored", () => {
  const s = run([{ type: "submit", option: 1 }, gradeLocally(problem, 3)]);
  assert.equal(s.status, "grading");
});

const row: PracticeRow = {
  id: "p1",
  order_index: 0,
  difficulty: "easy",
  question_text: "Q?",
  options: ["a", "b", "c", "d"],
  correct_option: 2,
  explanation: "Because C.",
  solution_steps: [],
  hint: "h",
  detailed_hint: null,
  time_recommendation_seconds: 60,
  concept_tags: ["x"],
  option_hints: [{ optionIndex: 0, misconception: "m", hint: "oh" }],
};

test("public practice payload carries no answer key", () => {
  const pub = toPublicPracticeProblem(row) as Record<string, unknown>;
  for (const k of ["correctOption", "correct_option", "explanation", "solutionSteps", "optionHints", "conceptTags"]) {
    assert.equal(k in pub, false, `${k} leaked`);
  }
  assert.equal(pub.graded, "server");
});

test("server grade reveals the key only when correct or on reveal", () => {
  assert.equal(gradePracticeAnswer(row, 0, false).answer, undefined);
  assert.equal(gradePracticeAnswer(row, 0, false).optionHint?.hint, "oh");
  assert.equal(gradePracticeAnswer(row, 1, true).answer?.correctOption, 2);
  assert.equal(gradePracticeAnswer(row, 1, true).isCorrect, false);
  assert.equal(gradePracticeAnswer(row, 2, false).isCorrect, true);
});
