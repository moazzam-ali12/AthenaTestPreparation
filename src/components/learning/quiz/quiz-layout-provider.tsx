"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useQuizState } from "@/components/learning/quiz/use-quiz-state";
import { useQuizTimer } from "@/components/learning/quiz/use-quiz-timer";
import { QuizRouteContext, type UnlockData } from "@/components/learning/quiz/quiz-route-context";
import type { Problem } from "@/components/quiz/types";
import type { FeedbackState } from "@/components/quiz/answer-panel";

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

type QuizLayoutProviderProps = {
  problems: Problem[];
  topicName: string;
  subtopicName: string;
  subject?: "math" | "english" | "reading" | "science";
  struggling?: boolean;
  basePath: string;
  practiceProblemsUrl?: string;
  onSaveResults: (payload: SavePayload) => Promise<UnlockData | void>;
  children: React.ReactNode;
};

export function QuizLayoutProvider({
  problems,
  topicName,
  subtopicName,
  subject,
  struggling = false,
  basePath,
  practiceProblemsUrl,
  onSaveResults,
  children,
}: QuizLayoutProviderProps) {
  const pathname = usePathname();
  const onTutorRoute = pathname.endsWith("/tutor");

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

  const handleSelectAnswer = useCallback(
    (problemId: string, optionIndex: number) => {
      const problem = problems.find((p) => p.id === problemId);
      if (!problem) return;

      const isCorrect = optionIndex === problem.correctOption;
      const responseTimeMs = quiz.getQuestionElapsedMs(problemId);

      if (isCorrect) {
        quiz.selectAnswer(problemId, optionIndex);
        setLockedIds((prev) => new Set(prev).add(problemId));
        setFeedbackMap((prev) =>
          new Map(prev).set(problemId, { type: "correct", correctOption: problem.correctOption })
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
          new Map(prev).set(problemId, { type: "wrong", correctOption: problem.correctOption })
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
    [lockedIds, problems, quiz, onTutorRoute, recordEvent]
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
        isCorrect: quiz.answers.get(p.id) === p.correctOption,
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
        if (result) setUnlockData(result);
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
