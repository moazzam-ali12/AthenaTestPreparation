import { Shield, Sword, Crown, Star, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Rank = {
  name: string;
  threshold: number;
  weapon: string;
  icon: LucideIcon;
  emoji: string;
};

// CPA has no composite score — each of the 6 sections (AUD/FAR/REG/BAR/ISC/TCP)
// is independently pass/fail. Thresholds below are milestones against
// cumulative XP earned from quests and practice, an exam-agnostic progress
// signal that survived the ACT -> CPA migration unchanged.
export const RANKS: Rank[] = [
  { name: "Bronze", threshold: 0, weapon: "Bronze Shield", icon: Shield, emoji: "🥉" },
  { name: "Silver", threshold: 250, weapon: "Silver Blade", icon: Sword, emoji: "🥈" },
  { name: "Gold", threshold: 750, weapon: "Gold Crown", icon: Crown, emoji: "🥇" },
  { name: "Platinum", threshold: 1500, weapon: "Platinum Star", icon: Star, emoji: "🔮" },
  { name: "Diamond", threshold: 3000, weapon: "Diamond Ascension", icon: Sparkles, emoji: "💎" },
];

export function getRank(score: number): Rank {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (score >= RANKS[i].threshold) return RANKS[i];
  }
  return RANKS[0];
}

export function getNextRank(score: number): Rank | null {
  const current = getRank(score);
  const idx = RANKS.indexOf(current);
  return idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}

export function getRankProgress(score: number) {
  const current = getRank(score);
  const next = getNextRank(score);

  if (!next) {
    return { current, next: null, pct: 100, pointsToNext: 0 };
  }

  const range = next.threshold - current.threshold;
  const progress = score - current.threshold;
  const pct = Math.min(Math.max(Math.round((progress / range) * 100), 0), 100);

  return {
    current,
    next,
    pct,
    pointsToNext: next.threshold - score,
  };
}
