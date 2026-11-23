import type { DifficultyBand } from "@/lib/adaptive/engine";

/** Subtopic quiz composition: 20 questions, ramping easy -> medium -> hard. */
export const QUIZ_MIX: Record<DifficultyBand, number> = { easy: 6, medium: 8, hard: 6 };

const BAND_ORDER: DifficultyBand[] = ["easy", "medium", "hard"];

// Nearest bands first, used when a subtopic is short on one band.
const FALLBACK: Record<DifficultyBand, DifficultyBand[]> = {
  easy: ["medium", "hard"],
  medium: ["easy", "hard"],
  hard: ["medium", "easy"],
};

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks the subtopic quiz: QUIZ_MIX per band, ordered easy -> medium -> hard,
 * filling a short band from its nearest neighbour.
 *
 * Deterministic for a given seed. Callers seed with user + subtopic + attempt
 * number so a refetch mid-quiz returns the same questions (the quiz indexes
 * problems by position), while each retry gets a fresh draw.
 */
export function selectQuizProblems<P extends { difficulty: string | null }>(
  problems: P[],
  seed: string
): P[] {
  const rand = seededRandom(seed);
  const pools: Record<DifficultyBand, P[]> = { easy: [], medium: [], hard: [] };
  for (const p of problems) {
    const band = (BAND_ORDER as string[]).includes(p.difficulty ?? "")
      ? (p.difficulty as DifficultyBand)
      : "medium";
    pools[band].push(p);
  }
  // Fisher-Yates with the seeded PRNG.
  for (const pool of Object.values(pools)) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }

  const picked: Record<DifficultyBand, P[]> = { easy: [], medium: [], hard: [] };
  for (const band of BAND_ORDER) {
    picked[band].push(...pools[band].splice(0, QUIZ_MIX[band]));
  }
  // Top up any short band from its neighbours, keeping it in that slot of
  // the easy -> hard ramp.
  for (const band of BAND_ORDER) {
    for (const from of FALLBACK[band]) {
      const short = QUIZ_MIX[band] - picked[band].length;
      if (short <= 0) break;
      picked[band].push(...pools[from].splice(0, short));
    }
  }

  return [...picked.easy, ...picked.medium, ...picked.hard];
}
