// Section / overall score calculations and their stability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleScore, computeSectionExamScore, CPA_PASSING_SCORE } from "./cpa-scoring";
import { calculateSkillScore } from "./scoring";
import {
  averagePracticedLevel,
  getSectionLevels,
  isReadyForOverallLevelUp,
  updateSkillAfterAnswer,
  composeDailyQuestBuckets,
  distributeQuestQuestions,
} from "./adaptive/engine";
import { skill } from "./adaptive/skill.fixtures";

test("scaled score: 0-99, linear, clamped, pass at 75", () => {
  assert.equal(scaleScore(0, 20), 0);
  assert.equal(scaleScore(20, 20), 99);
  assert.equal(scaleScore(15, 20), 74);
  assert.equal(scaleScore(25, 20), 99, "clamped");
  assert.equal(scaleScore(5, 0), 0, "no questions");
  assert.deepEqual(computeSectionExamScore(16, 20), { scaledScore: 79, passed: true });
  assert.deepEqual(computeSectionExamScore(15, 20), { scaledScore: 74, passed: false });
  assert.equal(CPA_PASSING_SCORE, 75);
  for (let c = 1; c <= 50; c++) assert.ok(scaleScore(c, 50) >= scaleScore(c - 1, 50), "monotonic");
});

test("weighted skill score counts hard questions more", () => {
  assert.equal(calculateSkillScore([]), 0);
  assert.equal(calculateSkillScore([{ difficulty: "hard", isCorrect: true }, { difficulty: "easy", isCorrect: false }]), 75);
  assert.equal(calculateSkillScore([{ difficulty: "x", isCorrect: true }]), 100, "unknown difficulty weighs 1");
});

test("section score is cumulative: one 20-question set moves an established score ≤ 7 points", () => {
  // 200 prior answers at 70% -> 69. A perfect or a zero set can only nudge it.
  const before = scaleScore(140, 200);
  const best = scaleScore(160, 220);
  const worst = scaleScore(140, 220);
  assert.ok(best - before <= 7 && before - worst <= 7, `${worst} <- ${before} -> ${best}`);
});

test("section level averages practiced subtopics only; overall level-up needs every section maxed", () => {
  assert.equal(averagePracticedLevel([{ level: 1, totalAttempts: 0 }]), null);
  assert.equal(averagePracticedLevel([{ level: 4, totalAttempts: 3 }, { level: 7, totalAttempts: 1 }, { level: 1, totalAttempts: 0 }]), 5.5);
  const maxed = (sec: string, n: number) =>
    Array.from({ length: n }, () => ({ sectionCategory: sec, level: 10, totalAttempts: 5 }));
  const counts = { AUD: 4, FAR: 4 };
  assert.ok(isReadyForOverallLevelUp(getSectionLevels([...maxed("AUD", 2), ...maxed("FAR", 2)], ["AUD", "FAR"], counts)));
  assert.ok(!isReadyForOverallLevelUp(getSectionLevels([...maxed("AUD", 2), ...maxed("FAR", 1)], ["AUD", "FAR"], counts)), "coverage < 50%");
  assert.ok(!isReadyForOverallLevelUp([]));
});

test("one daily quest can't swing a section level by more than 1", () => {
  // Established learner: 12 practiced subtopics at levels 3-8 with full windows at ~70%.
  const window = [true, true, false, true, true, false, true, true, false, true];
  const skills = Array.from({ length: 12 }, (_, i) =>
    skill({ subtopicId: `s${i}`, level: 3 + (i % 6), totalAttempts: 30, last10: window })
  );
  const plan = distributeQuestQuestions(composeDailyQuestBuckets(skills), 20);
  for (const outcome of [true, false]) {
    const after = skills.map((s) => {
      const n = plan.find((p) => p.subtopicId === s.subtopicId)?.questionCount ?? 0;
      let cur = s;
      for (let i = 0; i < n; i++) cur = { ...cur, ...updateSkillAfterAnswer(cur, outcome, 5) };
      assert.ok(Math.abs(cur.level - s.level) <= 2, `${s.subtopicId}: ${s.level} -> ${cur.level}`);
      return cur;
    });
    const delta = averagePracticedLevel(after)! - averagePracticedLevel(skills)!;
    assert.ok(Math.abs(delta) <= 1, `all ${outcome ? "correct" : "wrong"}: section level moved ${delta}`);
  }
});
