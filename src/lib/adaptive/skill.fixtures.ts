import type { SubsectionSkill } from "@/types/adaptive";

/** A subsection skill row with defaults (fresh, level 1). Shared by the adaptive/scoring tests. */
export function skill(over: Partial<SubsectionSkill> = {}): SubsectionSkill {
  return {
    id: "s", userId: "u", subtopicId: "sub", sectionCategory: "AUD",
    level: 1, xp: 0, totalAttempts: 0, correctAttempts: 0, last10: [], streakCorrect: 0, streakWrong: 0,
    lastSeenAt: null, createdAt: "", updatedAt: "", ...over,
  };
}
