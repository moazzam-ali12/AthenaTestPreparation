"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PracticeGradientCard } from "@/components/quiz/practice-gradient-card";
import type { Problem } from "@/components/quiz/types";

type QuizPracticeLoopProps = {
  topicSlug: string;
  subtopicSlug: string;
  difficulty?: string;
  onComplete: () => void;
  onNeedsMicroLesson: () => void;
};

export function QuizPracticeLoop({
  topicSlug,
  subtopicSlug,
  difficulty,
  onComplete,
  onNeedsMicroLesson,
}: QuizPracticeLoopProps) {
  const [problemIndex, setProblemIndex] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["quiz-practice-loop", topicSlug, subtopicSlug, difficulty],
    queryFn: () => {
      const url = `/api/learning/${topicSlug}/${subtopicSlug}/practice-problems${difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : ""}`;
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error("Failed to load practice problems");
        return r.json() as Promise<{ problems: Problem[] }>;
      });
    },
    staleTime: 10 * 60_000,
  });

  const problems = (data?.problems ?? []).slice(0, 2);
  const currentProblem = problems[problemIndex];

  const handleCorrect = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleExhausted = useCallback(() => {
    if (problemIndex === 0 && problems.length > 1) {
      setProblemIndex(1);
    } else {
      onNeedsMicroLesson();
    }
  }, [problemIndex, problems.length, onNeedsMicroLesson]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <motion.div
          animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="h-8 w-8 text-athena-amber" />
        </motion.div>
        <p className="text-sm text-muted-foreground">Preparing practice problems…</p>
      </div>
    );
  }

  if (isError || problems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <p className="text-sm text-destructive">Could not load practice problems.</p>
        <Button variant="outline" size="sm" onClick={onComplete}>
          Skip Practice
        </Button>
      </div>
    );
  }

  if (!currentProblem) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Progress */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Practice Problem {problemIndex + 1} of {problems.length}
        </span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-athena-amber rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(problemIndex / problems.length) * 100}%` }}
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
            questionNumber={problemIndex + 1}
            onCorrect={handleCorrect}
            onExhausted={handleExhausted}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
