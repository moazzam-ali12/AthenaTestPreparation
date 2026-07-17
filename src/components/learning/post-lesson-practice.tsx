"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sparkles, CheckCircle, XCircle, ChevronRight } from "lucide-react";
import { PracticeGradientCard } from "@/components/quiz/practice-gradient-card";
import { LessonCongratsScreen } from "@/components/learning/lesson-congrats-screen";
import type { Problem } from "@/components/quiz/types";

type PostLessonPracticeProps = {
  topic: string;
  subtopic: string;
  subject?: "math" | "english" | "reading" | "science";
  onComplete: () => void;
  maxProblems?: number;
  /** When true, calls onComplete automatically after the last problem (no summary screen). */
  autoComplete?: boolean;
  /** When provided, skip the API call and use these problems directly. */
  problems?: Problem[];
  /** Optional metadata for the congrats screen (shown when autoComplete is false). */
  topicName?: string;
  subtopicName?: string;
  lessonType?: "micro-lesson" | "quiz";
  learningObjectives?: string[];
  keyFormulas?: { latex: string; description: string }[];
};

export function PostLessonPractice({
  topic,
  subtopic,
  subject = "math",
  onComplete,
  maxProblems,
  autoComplete = false,
  problems: providedProblems,
  topicName,
  subtopicName,
  lessonType,
  learningObjectives,
  keyFormulas,
}: PostLessonPracticeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["practice-problems", topic, subtopic, subject],
    queryFn: () =>
      fetch("/api/agent/practice-problems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, subtopic, subject }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to load practice problems");
        return r.json() as Promise<{ problems: Problem[] }>;
      }),
    staleTime: 10 * 60_000,
    enabled: !providedProblems,
  });

  const allProblems = providedProblems ?? data?.problems ?? [];
  const problems = maxProblems != null ? allProblems.slice(0, maxProblems) : allProblems;
  const totalProblems = problems.length;
  const isDone = totalProblems > 0 && currentIndex >= totalProblems;

  // Auto-navigate when in exposure mode (no summary needed)
  useEffect(() => {
    if (isDone && autoComplete) {
      onComplete();
    }
  }, [isDone, autoComplete, onComplete]);

  const advance = useCallback(() => {
    setCurrentIndex((i) => i + 1);
  }, []);

  const handleCorrect = useCallback(() => {
    setCorrectCount((c) => c + 1);
    advance();
  }, [advance]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <motion.div
          animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-8 w-8 text-athena-amber" />
        </motion.div>
        <p className="text-sm text-muted-foreground">
          Preparing practice problems…
        </p>
      </div>
    );
  }

  if (isError || problems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <p className="text-sm text-destructive">
          Could not load practice problems.
        </p>
        <Button variant="outline" size="sm" onClick={onComplete}>
          Skip Practice
        </Button>
      </div>
    );
  }

  // Congrats / summary screen (shown only when autoComplete is false)
  if (isDone) {
    if (topicName && subtopicName && lessonType) {
      return (
        <LessonCongratsScreen
          topicName={topicName}
          subtopicName={subtopicName}
          lessonType={lessonType}
          score={{ correct: correctCount, total: totalProblems }}
          learningObjectives={learningObjectives}
          keyFormulas={keyFormulas}
          onDone={onComplete}
        />
      );
    }

    // Fallback: simple summary if no metadata props provided
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center"
      >
        <div className="flex flex-col items-center gap-2">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            {correctCount === totalProblems ? (
              <CheckCircle className="h-16 w-16 text-green-500" />
            ) : (
              <XCircle className="h-16 w-16 text-athena-amber" />
            )}
          </motion.div>
          <h3 className="text-xl font-semibold">
            {correctCount}/{totalProblems} correct
          </h3>
          <p className="text-sm text-muted-foreground">
            {correctCount === totalProblems
              ? "Perfect! Great work."
              : "Keep practicing, you are making progress!"}
          </p>
        </div>
        <Button onClick={onComplete} className="gap-2">
          Done
          <ChevronRight className="h-4 w-4" />
        </Button>
      </motion.div>
    );
  }

  const currentProblem = problems[currentIndex];
  if (!currentProblem) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Progress */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Practice {currentIndex + 1} of {totalProblems}
        </span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-athena-amber rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(currentIndex / totalProblems) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Question with gradient scaffolding */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentProblem.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto"
        >
          <PracticeGradientCard
            problem={currentProblem}
            questionNumber={currentIndex + 1}
            onCorrect={handleCorrect}
            onExhausted={advance}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
