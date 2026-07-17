"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CpaExamContext, type CpaExamPhase } from "./cpa-exam-context";
import { useAnswerCpaExam, useSubmitCpaExam } from "@/hooks/use-cpa-exam";
import { SECTION_TIME_LIMIT_SECONDS } from "@/types/cpa-exam";
import type {
  CpaSectionExamProblem,
  CpaSectionExamAnswer,
  CpaSectionExamAttempt,
  CpaSectionExam,
} from "@/types/cpa-exam";

type Props = {
  attempt: CpaSectionExamAttempt;
  test: CpaSectionExam;
  problems: CpaSectionExamProblem[];
  initialAnswers: CpaSectionExamAnswer[];
  children: React.ReactNode;
};

export function CpaExamProvider({
  attempt,
  test,
  problems,
  initialAnswers,
  children,
}: Props) {
  const router = useRouter();
  const answerMutation = useAnswerCpaExam();
  const submitMutation = useSubmitCpaExam();

  const [answers, setAnswers] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const a of initialAnswers) {
      if (a.selectedOption != null) {
        map.set(a.problemId, a.selectedOption);
      }
    }
    return map;
  });

  const [lockedIds, setLockedIds] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const a of initialAnswers) {
      if (a.selectedOption != null) set.add(a.problemId);
    }
    return set;
  });

  const resumeIndex = useMemo(() => {
    for (let i = 0; i < problems.length; i++) {
      if (!lockedIds.has(problems[i].problemId)) return i;
    }
    return 0;
  }, [problems, lockedIds]);

  const [currentIndex, setCurrentIndex] = useState(resumeIndex);
  const [direction, setDirection] = useState(1);

  const [phase, setPhase] = useState<CpaExamPhase>(() =>
    attempt.status === "completed" ? "completed" : "active"
  );

  const currentProblem = problems[currentIndex] ?? null;

  const examStartRef = useRef(Date.now());
  const [timeLeft, setTimeLeft] = useState(() =>
    Math.max(0, SECTION_TIME_LIMIT_SECONDS - (attempt.totalTimeSeconds ?? 0))
  );

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase !== "active") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    examStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  useEffect(() => {
    if (timeLeft === 0 && phase === "active") {
      submitExam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  const displayTime = useMemo(() => {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentIndex((i) => Math.min(i + 1, problems.length - 1));
  }, [problems.length]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setDirection(index > currentIndex ? 1 : -1);
      setCurrentIndex(Math.max(0, Math.min(index, problems.length - 1)));
    },
    [currentIndex, problems.length]
  );

  const handleSelectAnswer = useCallback(
    (problemId: string, optionIndex: number) => {
      if (phase !== "active") return;

      const problem = problems.find((p) => p.problemId === problemId);
      if (!problem) return;

      setAnswers((prev) => new Map(prev).set(problemId, optionIndex));
      setLockedIds((prev) => new Set(prev).add(problemId));

      answerMutation.mutate({
        attemptId: attempt.id,
        problemId,
        module: problem.module,
        orderIndex: problem.orderIndex,
        selectedOption: optionIndex,
        isCorrect: optionIndex === problem.correctOption,
        responseTimeMs: undefined,
      });
    },
    [phase, problems, attempt.id, answerMutation]
  );

  const submitExam = useCallback(() => {
    const elapsed = Math.round((Date.now() - examStartRef.current) / 1000);
    const totalTimeSeconds = (attempt.totalTimeSeconds ?? 0) + elapsed;

    setPhase("completed");

    submitMutation.mutate(
      {
        attemptId: attempt.id,
        totalTimeSeconds,
      },
      {
        onSuccess: () => {
          router.push(`/practice-exam/${attempt.id}/results`);
        },
      }
    );
  }, [attempt.id, attempt.totalTimeSeconds, submitMutation, router]);

  const getQuestionStatus = useCallback(
    (index: number): "unanswered" | "answered" => {
      const problem = problems[index];
      if (!problem) return "unanswered";
      return lockedIds.has(problem.problemId) ? "answered" : "unanswered";
    },
    [problems, lockedIds]
  );

  const answeredCount = lockedIds.size;

  return (
    <CpaExamContext.Provider
      value={{
        attempt,
        test,
        problems,
        currentIndex,
        currentProblem,
        answers,
        lockedIds,
        phase,
        timeLeft,
        displayTime,
        goNext,
        goBack,
        goTo,
        direction,
        handleSelectAnswer,
        submitExam,
        getQuestionStatus,
        totalQuestions: problems.length,
        answeredCount,
      }}
    >
      {children}
    </CpaExamContext.Provider>
  );
}
