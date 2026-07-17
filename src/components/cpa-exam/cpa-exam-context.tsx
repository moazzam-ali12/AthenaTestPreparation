"use client";

import { createContext, useContext } from "react";
import type {
  CpaSectionExamProblem,
  CpaSectionExamAttempt,
  CpaSectionExam,
} from "@/types/cpa-exam";

export type CpaExamPhase = "active" | "completed";

export type CpaExamContextValue = {
  attempt: CpaSectionExamAttempt;
  test: CpaSectionExam;
  problems: CpaSectionExamProblem[];

  currentIndex: number;
  currentProblem: CpaSectionExamProblem | null;

  answers: Map<string, number>;
  lockedIds: Set<string>;
  phase: CpaExamPhase;

  timeLeft: number;
  displayTime: string;

  goNext: () => void;
  goBack: () => void;
  goTo: (index: number) => void;
  direction: number;

  handleSelectAnswer: (problemId: string, optionIndex: number) => void;
  submitExam: () => void;

  getQuestionStatus: (index: number) => "unanswered" | "answered";
  totalQuestions: number;
  answeredCount: number;
};

export const CpaExamContext = createContext<CpaExamContextValue | null>(null);

export function useCpaExamContext() {
  const ctx = useContext(CpaExamContext);
  if (!ctx) throw new Error("useCpaExamContext must be used within CpaExamProvider");
  return ctx;
}
