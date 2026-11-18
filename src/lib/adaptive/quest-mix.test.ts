// Daily quest composition: always 20 questions, 60/30/10 weak/mid/stretch within tolerance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDailyQuestBuckets, distributeQuestQuestions, DIFFICULTY_TIER_LEVELS } from "./engine";
import { skill } from "./skill.fixtures";

const mix = (n: number, overallLevel = 1) => {
  const skills = Array.from({ length: n }, (_, i) =>
    skill({ subtopicId: `s${i}`, level: 1 + (i % 10), totalAttempts: i % 3 })
  );
  const dist = distributeQuestQuestions(composeDailyQuestBuckets(skills, new Map(), overallLevel), 20);
  const sum = (b: string) => dist.filter((d) => d.bucket === b).reduce((a, d) => a + d.questionCount, 0);
  return { dist, weak: sum("weak"), mid: sum("mid"), stretch: sum("stretch") };
};

test("quest is always 20 questions, whatever the number of unlocked subtopics", () => {
  for (let n = 1; n <= 60; n++) {
    const m = mix(n);
    assert.equal(m.weak + m.mid + m.stretch, 20, `n=${n}`);
    assert.ok(m.dist.every((d) => d.questionCount >= 0));
  }
});

test("60/30/10 skill mix (±1 question) once all three buckets exist", () => {
  for (let n = 4; n <= 60; n++) {
    const m = mix(n);
    const hasStretch = m.dist.some((d) => d.bucket === "stretch");
    const ok = hasStretch
      ? Math.abs(m.weak - 12) <= 1 && Math.abs(m.mid - 6) <= 1 && Math.abs(m.stretch - 2) <= 1
      : m.weak === 12 && m.mid === 8;
    assert.ok(ok, `n=${n} ${m.weak}/${m.mid}/${m.stretch}`);
  }
  // Rounding leaves no stretch subtopic at n = 3, 5, 6 (6 = a new user's one open subtopic per
  // section): its share rolls into mid, never lost.
  for (const n of [3, 5, 6]) assert.deepEqual([mix(n).weak, mix(n).mid, mix(n).stretch], [12, 8, 0], `n=${n}`);
  assert.deepEqual([mix(1).weak, mix(1).mid, mix(1).stretch], [20, 0, 0]);
});

test("weakest subtopics fill the weak bucket; stretch is one tier up", () => {
  const skills = [9, 1, 5, 3, 7, 2, 8, 4, 6, 10].map((level, i) => skill({ subtopicId: `s${i}`, level }));
  const buckets = composeDailyQuestBuckets(skills);
  const levelOf = (id: string) => skills.find((s) => s.subtopicId === id)!.level;
  const weak = buckets.filter((b) => b.bucket === "weak").map((b) => levelOf(b.subtopicId));
  assert.deepEqual(weak.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  const stretch = buckets.find((b) => b.bucket === "stretch")!;
  assert.equal(levelOf(stretch.subtopicId), 10);
  assert.equal(stretch.targetDifficulty, DIFFICULTY_TIER_LEVELS.hard);
  // A recent bad quest pushes a subtopic toward weak without changing its difficulty.
  const adjusted = composeDailyQuestBuckets(skills, new Map([["s0", -9]]));
  const s0 = adjusted.find((b) => b.subtopicId === "s0")!;
  assert.equal(s0.bucket, "weak");
  assert.equal(s0.targetDifficulty, DIFFICULTY_TIER_LEVELS.hard);
});
