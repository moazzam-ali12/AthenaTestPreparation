"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { usePathname } from "next/navigation";
import { useQuizState } from "@/components/learning/quiz/use-quiz-state";
import { useQuizTimer } from "@/components/learning/quiz/use-quiz-timer";
import { QuizRouteContext, type UnlockData } from "@/components/learning/quiz/quiz-route-context";
import type { AnswerReveal, Problem } from "@/components/quiz/types";
import type { FeedbackState } from "@/components/quiz/answer-panel";
import type { CpaSubject } from "@/types/cpa-exam";

type QuizEvent = {
  problemId: string;
  eventType: string;
  responseTimeMs?: number;
  selectedOption?: number;
  wrongCount?: number;
  practiceProblemId?: string;
  timestamp: string;
};

type SavePayload = {
  score: number;
  totalQuestions: number;
  timeElapsedSeconds: number;
  answers: {
    problemId: string;
    selectedOption: number;
    isCorrect: boolean;
    responseTimeMs?: number;
    wrongCount?: number;
    hintUsed?: boolean;
    tutorUsed?: boolean;
    practiceCompleted?: boolean;
  }[];
  events?: QuizEvent[];
};

/** Server verdict for one answer, plus that question's (now revealed) answer data. */
export type CheckedAnswer = { isCorrect: boolean } & AnswerReveal;

type QuizLayoutProviderProps = {
  problems: Problem[];
  topicName: string;
  subtopicName: string;
  subject?: CpaSubject;
  subtopicId?: string;
  struggling?: boolean;
  basePath: string;
  practiceProblemsUrl?: string;
  /** May return `reveals` (post-submit answer data) for the review screen. */
  onSaveResults: (
    payload: SavePayload
  ) => Promise<(UnlockData & { reveals?: Record<string, AnswerReveal> }) | void>;
  /**
   * Server-side grading for quizzes whose payload carries no answers
   * (problems arrive with HIDDEN_ANSWER). Resolve null when the answer was
   * refused (e.g. trial 402 — the upgrade modal handles that). Omit to grade
   * locally against `problem.correctOption`.
   */
  checkAnswer?: (problemId: string, selectedOption: number) => Promise<CheckedAnswer | null>;
  children: React.ReactNode;
};

export function QuizLayoutProvider({
  problems: baseProblems,
  topicName,
  subtopicName,
  subject,
  subtopicId,
  struggling = false,
  basePath,
  practiceProblemsUrl,
  onSaveResults,
  checkAnswer,
  children,
}: QuizLayoutProviderProps) {
  const pathname = usePathname();
  const onTutorRoute = pathname.endsWith("/tutor");

  // Answers revealed by the server, merged over the answer-less payload so
  // the rest of the quiz (scoring, hints, solution, tutor) reads them as usual.
  const [revealed, setRevealed] = useState<Map<string, AnswerReveal>>(new Map());
  const problems = useMemo(
    () =>
      revealed.size === 0
        ? baseProblems
        : baseProblems.map((p) => {
            const r = revealed.get(p.id);
            return r ? { ...p, ...r } : p;
          }),
    [baseProblems, revealed]
  );
  const pendingIdsRef = useRef<Set<string>>(new Set());

  const quiz = useQuizState(problems);
  const timer = useQuizTimer(problems, quiz.phase);

  const [feedbackMap, setFeedbackMap] = useState<Map<string, FeedbackState>>(new Map());
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [unlockData, setUnlockData] = useState<UnlockData | null>(null);
  const [stuckModalShownIds, setStuckModalShownIds] = useState<Set<string>>(new Set());
  const markStuckModalShown = useCallback((problemId: string) => {
    setStuckModalShownIds((prev) => new Set(prev).add(problemId));
  }, []);

  const [practiceEntryModalShownIds, setPracticeEntryModalShownIds] = useState<Set<string>>(new Set());
  const markPracticeEntryModalShown = useCallback((problemId: string) => {
    setPracticeEntryModalShownIds((prev) => new Set(prev).add(problemId));
  }, []);

  // Event buffer for tracking — accumulated during quiz, flushed on submit
  const eventsRef = useRef<QuizEvent[]>([]);
  const recordEvent = useCallback(
    (event: Omit<QuizEvent, "timestamp">) => {
      eventsRef.current.push({ ...event, timestamp: new Date().toISOString() });
    },
    []
  );

  const prevIndexRef = useRef(0);
  const direction = quiz.currentIndex >= prevIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevIndexRef.current = quiz.currentIndex;
  }, [quiz.currentIndex]);

  // Pause timer when on tutor sub-route
  useEffect(() => {
    if (onTutorRoute) timer.pause();
    else timer.resume();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTutorRoute]);

  // Lock body scroll for the entire quiz flow
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const applyAnswer = useCallback(
    (problemId: string, optionIndex: number, isCorrect: boolean, correctOption: number, responseTimeMs: number) => {
      if (isCorrect) {
        quiz.selectAnswer(problemId, optionIndex);
        setLockedIds((prev) => new Set(prev).add(problemId));
        setFeedbackMap((prev) =>
          new Map(prev).set(problemId, { type: "correct", correctOption })
        );

        if (onTutorRoute) {
          recordEvent({ problemId, eventType: "tutor_correct", responseTimeMs, selectedOption: optionIndex });
          setTimeout(() => {
            setFeedbackMap((prev) => { const n = new Map(prev); n.delete(problemId); return n; });
            quiz.enterPractice(problemId);
          }, 1000);
        } else {
          recordEvent({ problemId, eventType: "answer_correct", responseTimeMs, selectedOption: optionIndex });
          setTimeout(() => {
            setFeedbackMap((prev) => { const n = new Map(prev); n.delete(problemId); return n; });
            quiz.goNext();
          }, 1200);
        }
      } else {
        if (lockedIds.has(problemId)) return;
        quiz.selectAnswer(problemId, optionIndex);
        setFeedbackMap((prev) =>
          new Map(prev).set(problemId, { type: "wrong", correctOption })
        );
        quiz.onWrongAnswer(problemId);

        const newWrongCount = quiz.getWrongCount(problemId) + 1;
        recordEvent({ problemId, eventType: "answer_wrong", responseTimeMs, selectedOption: optionIndex, wrongCount: newWrongCount });
        if (newWrongCount === 1) {
          recordEvent({ problemId, eventType: "hint_shown" });
        } else if (newWrongCount === 2) {
          recordEvent({ problemId, eventType: "tutor_entered" });
        }

        setTimeout(() => {
          setFeedbackMap((prev) => { const n = new Map(prev); n.delete(problemId); return n; });
        }, 2000);
      }
    },
    [lockedIds, quiz, onTutorRoute, recordEvent]
  );

  const handleSelectAnswer = useCallback(
    (problemId: string, optionIndex: number) => {
      const problem = problems.find((p) => p.id === problemId);
      if (!problem) return;
      const responseTimeMs = quiz.getQuestionElapsedMs(problemId);

      // Local grading: no server check configured, or this question's answer
      // was already revealed (retries are free and need no round trip).
      if (!checkAnswer || problem.correctOption >= 0) {
        applyAnswer(problemId, optionIndex, optionIndex === problem.correctOption, problem.correctOption, responseTimeMs);
        return;
      }

      if (lockedIds.has(problemId) || pendingIdsRef.current.has(problemId)) return;
      pendingIdsRef.current.add(problemId);
      checkAnswer(problemId, optionIndex)
        .then((res) => {
          if (!res) return;
          const { isCorrect, ...reveal } = res;
          setRevealed((prev) => new Map(prev).set(problemId, reveal));
          applyAnswer(problemId, optionIndex, isCorrect, reveal.correctOption, responseTimeMs);
        })
        .catch(() => toast.error("Couldn't check your answer. Please try again."))
        .finally(() => pendingIdsRef.current.delete(problemId));
    },
    [problems, quiz, checkAnswer, lockedIds, applyAnswer]
  );

  // Save results when submitted
  useEffect(() => {
    if (quiz.phase !== "submitted" || saveStatus !== "idle") return;
    setSaveStatus("saving");
    const answers = problems.map((p) => {
      const qPhase = quiz.getQuestionPhase(p.id);
      return {
        problemId: p.id,
        selectedOption: quiz.answers.has(p.id) ? quiz.answers.get(p.id)! : -1,
        // Same rule as the score memo: only a clean first-try solve counts.
        isCorrect: quiz.answers.get(p.id) === p.correctOption && quiz.getWrongCount(p.id) === 0,
        responseTimeMs: quiz.getQuestionElapsedMs(p.id),
        wrongCount: quiz.getWrongCount(p.id),
        hintUsed: qPhase === "hint" || qPhase === "tutor" || qPhase === "practice",
        tutorUsed: qPhase === "tutor" || qPhase === "practice",
        practiceCompleted: qPhase === "practice",
      };
    });
    onSaveResults({
      score: quiz.score,
      totalQuestions: problems.length,
      timeElapsedSeconds: timer.elapsed,
      answers,
      events: eventsRef.current,
    })
      .then((result) => {
        if (result) {
          const { reveals, ...unlock } = result;
          if (reveals) setRevealed((prev) => new Map([...prev, ...Object.entries(reveals)]));
          setUnlockData(unlock);
        }
        setSaveStatus("saved");
      })
      .catch(() => setSaveStatus("error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.phase, saveStatus]);

  return (
    <QuizRouteContext.Provider
      value={{
        problems,
        topicName,
        subtopicName,
        subject,
        subtopicId,
        basePath,
        practiceProblemsUrl,
        quiz,
        timer,
        feedbackMap,
        lockedIds,
        direction,
        saveStatus,
        setSaveStatus,
        setFeedbackMap,
        setLockedIds,
        handleSelectAnswer,
        stuckModalShownIds,
        markStuckModalShown,
        practiceEntryModalShownIds,
        markPracticeEntryModalShown,
        unlockData,
        struggling,
      }}
    >
      {children}
    </QuizRouteContext.Provider>
  );
}
