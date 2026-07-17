"use client";

import { createContext, useContext } from "react";
import type { Problem } from "@/components/quiz/types";
import type { FeedbackState } from "@/components/quiz/answer-panel";
import type { useQuizState } from "./use-quiz-state";
import type { useQuizTimer } from "./use-quiz-timer";
import type { Badge } from "@/lib/badges";
import type { RankUp } from "@/lib/gamification/check-unlocks";

export type UnlockData = { newBadges: Badge[]; rankUp: RankUp | null };

export type QuizRouteContextValue = {
  problems: Problem[];
  topicName: string;
  subtopicName: string;
  subject?: "math" | "english" | "reading" | "science";
  struggling: boolean;
  basePath: string;
  practiceProblemsUrl?: string;
  quiz: ReturnType<typeof useQuizState>;
  timer: ReturnType<typeof useQuizTimer>;
  feedbackMap: Map<string, FeedbackState>;
  lockedIds: Set<string>;
  direction: number;
  saveStatus: "idle" | "saving" | "saved" | "error";
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  setFeedbackMap: React.Dispatch<React.SetStateAction<Map<string, FeedbackState>>>;
  setLockedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleSelectAnswer: (problemId: string, optionIndex: number) => void;
  stuckModalShownIds: Set<string>;
  markStuckModalShown: (problemId: string) => void;
  practiceEntryModalShownIds: Set<string>;
  markPracticeEntryModalShown: (problemId: string) => void;
  unlockData: UnlockData | null;
};

export const QuizRouteContext = createContext<QuizRouteContextValue | null>(null);

export function useQuizRouteContext(): QuizRouteContextValue {
  const ctx = useContext(QuizRouteContext);
  if (!ctx) throw new Error("useQuizRouteContext must be used within QuizRouteLayout");
  return ctx;
}
