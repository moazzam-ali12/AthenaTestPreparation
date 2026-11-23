import { toast } from "sonner";
import { difficultyFloor } from "@/lib/adaptive/engine";

/** Celebrates an overall level-up returned by a quest/quiz/exam API. */
export function announceOverallLevelUp(newLevel: number | null | undefined) {
  if (!newLevel) return;
  toast.success(`Overall level ${newLevel} reached!`, {
    description: `Every section hit level 10. Subtopic levels reset to 1, and questions now start at ${difficultyFloor(newLevel)} difficulty.`,
    duration: 8000,
  });
}
