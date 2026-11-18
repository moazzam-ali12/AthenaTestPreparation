// Adaptive engine: level moves, difficulty floor, nearest-band fallback, and a 1,000-answer simulation.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SubsectionSkill } from "@/types/adaptive";
import {
  updateSkillAfterAnswer,
  computeAdaptiveLevel,
  difficultyFloor,
  effectiveBand,
  levelToBand,
  composeDailyQuestBuckets,
  DIFFICULTY_TIER_LEVELS,
  type DifficultyBand,
} from "./engine";
import { selectQuizProblems, QUIZ_MIX } from "./quiz-selection";
import { skill } from "./skill.fixtures";

/** Applies answers one by one, as the answer route does. */
function play(s: SubsectionSkill, answers: [boolean, number][]): SubsectionSkill {
  for (const [ok, diff] of answers) s = { ...s, ...updateSkillAfterAnswer(s, ok, diff) };
  return s;
}

test("level up after 3 challenging correct answers in a row (window ≥ 5, ≥ 80%)", () => {
  const s0 = skill({ level: 4, last10: [true, true, false, true, true], totalAttempts: 5 });
  const s2 = play(s0, [[true, 5], [true, 5]]);
  assert.equal(s2.level, 4, "2 correct is not enough");
  const s3 = play(s2, [[true, 5]]);
  assert.equal(s3.level, 5, "3rd correct promotes");
  assert.equal(s3.streakCorrect, 0, "streak resets after a level change (cooldown)");
});

test("no level up from 3 answers on a fresh skill (minimum 5 answers in the window)", () => {
  assert.equal(play(skill(), [[true, 3], [true, 3], [true, 3]]).level, 1);
  assert.equal(play(skill(), Array(5).fill([true, 3])).level, 2);
});

test("easy questions far below the level don't count toward a level up", () => {
  const s = play(skill({ level: 7, last10: Array(6).fill(true) }), Array(5).fill([true, 3]));
  assert.equal(s.level, 7);
});

test("level down after 2 wrong; 2 levels on a full window at ≤ 40%", () => {
  const s0 = skill({ level: 5, last10: Array(5).fill(true) });
  assert.equal(play(s0, [[false, 5]]).level, 5, "1 wrong keeps the level");
  assert.equal(play(s0, [[false, 5], [false, 5]]).level, 4);
  const bad = skill({ level: 6, last10: [...Array(6).fill(false), ...Array(4).fill(true)] });
  assert.equal(play(bad, [[false, 5], [false, 5]]).level, 4);
});

test("a wrong answer never promotes; level stays within 1..10", () => {
  assert.equal(computeAdaptiveLevel(skill({ level: 1, streakWrong: 5, last10: Array(10).fill(false) })), 1);
  assert.equal(computeAdaptiveLevel(skill({ level: 10, streakCorrect: 9, last10: Array(10).fill(true) })), 10);
  const s = skill({ level: 5, streakCorrect: 3, streakWrong: 2, last10: Array(10).fill(true) });
  assert.ok(computeAdaptiveLevel(s) < 5);
});

test("difficulty floor rises with the overall level", () => {
  assert.deepEqual([1, 2, 3, 7].map(difficultyFloor), ["easy", "medium", "hard", "hard"]);
  // Subtopic reset to level 1 after an overall level-up: still served at the floor.
  assert.equal(effectiveBand(1, 1), "easy");
  assert.equal(effectiveBand(1, 2), "medium");
  assert.equal(effectiveBand(1, 3), "hard");
  // Own band above the floor wins.
  assert.equal(effectiveBand(9, 2), "hard");
  const skills = Array.from({ length: 10 }, (_, i) => skill({ subtopicId: `s${i}`, level: 1 }));
  for (const b of composeDailyQuestBuckets(skills, new Map(), 3)) {
    assert.ok(b.targetDifficulty >= DIFFICULTY_TIER_LEVELS.hard, `${b.bucket} at ${b.targetDifficulty}`);
  }
});

type P = { id: number; difficulty: DifficultyBand };
const pool = (counts: Partial<Record<DifficultyBand, number>>): P[] => {
  let id = 0;
  return (Object.entries(counts) as [DifficultyBand, number][]).flatMap(([d, n]) =>
    Array.from({ length: n }, () => ({ id: id++, difficulty: d }))
  );
};
const bands = (ps: P[]) => ps.map((p) => p.difficulty);

test("quiz falls back to the nearest difficulty when a band is short", () => {
  // No hard questions: hard slots come from medium (nearest), not easy.
  const noHard = selectQuizProblems(pool({ easy: 20, medium: 20 }), "seed");
  assert.equal(noHard.length, 20);
  assert.deepEqual(bands(noHard.slice(14)), Array(6).fill("medium"));
  // No medium: medium slots come from easy first, then hard.
  const noMed = selectQuizProblems(pool({ easy: 8, hard: 20 }), "seed");
  assert.deepEqual(bands(noMed.slice(6, 14)), ["easy", "easy", ...Array(6).fill("hard")]);
  // Full pool: exact mix, ramped easy -> medium -> hard, deterministic per seed.
  const full = selectQuizProblems(pool({ easy: 30, medium: 30, hard: 30 }), "u1:sub:1");
  assert.deepEqual(
    [QUIZ_MIX.easy, QUIZ_MIX.medium, QUIZ_MIX.hard],
    ["easy", "medium", "hard"].map((b) => bands(full).filter((x) => x === b).length)
  );
  assert.deepEqual(full, selectQuizProblems(pool({ easy: 30, medium: 30, hard: 30 }), "u1:sub:1"));
});

/** Deterministic PRNG so the simulation is stable across runs. */
function rng(seed: number) {
  return () => ((seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0), (seed >>> 0) / 4294967296);
}

/** 1,000 answers from a learner of fixed ability; returns the share of questions per band. */
function simulate(ability: number, seed: number) {
  const rand = rng(seed);
  let s = skill();
  const served: Record<DifficultyBand, number> = { easy: 0, medium: 0, hard: 0 };
  for (let i = 0; i < 1000; i++) {
    const band = levelToBand(s.level);
    const diff = DIFFICULTY_TIER_LEVELS[band];
    served[band]++;
    const pCorrect = 1 / (1 + Math.exp(diff - ability));
    s = { ...s, ...updateSkillAfterAnswer(s, rand() < pCorrect, diff) };
    assert.ok(s.level >= 1 && s.level <= 10);
  }
  return { share: (b: DifficultyBand) => served[b] / 1000, level: s.level };
}

test("1,000 simulated answers: questions concentrate at the learner's ability", () => {
  for (const seed of [1, 2, 3]) {
    const weak = simulate(2, seed);
    const strong = simulate(10, seed);
    const mid = simulate(6, seed);
    assert.ok(weak.share("easy") >= 0.9, `weak learner easy share ${weak.share("easy")}`);
    assert.ok(strong.share("hard") >= 0.8, `strong learner hard share ${strong.share("hard")}`);
    assert.ok(mid.share("medium") >= 0.4, `mid learner medium share ${mid.share("medium")}`);
    assert.ok(weak.level <= 3 && strong.level >= 7, `levels ${weak.level} / ${strong.level}`);
  }
});
