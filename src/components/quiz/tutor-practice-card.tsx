"use client";

import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PracticeGradientCard } from "@/components/quiz/practice-gradient-card";
import type { Problem } from "@/components/quiz/types";

type TutorPracticeCardProps = {
  practiceProblemsUrl?: string;
  difficulty?: string;
  onComplete: () => void;
  onNeedsMicroLesson: () => void;
  onCurrentProblemChange?: (problem: Problem | null) => void;
};

export function TutorPracticeCard({
  practiceProblemsUrl,
  difficulty,
  onComplete,
  onNeedsMicroLesson,
  onCurrentProblemChange,
}: TutorPracticeCardProps) {
  const [problemIndex, setProblemIndex] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tutor-practice-card", practiceProblemsUrl, difficulty],
    queryFn: () => {
      if (!practiceProblemsUrl) return Promise.resolve({ problems: [] });
      const url = `${practiceProblemsUrl}${difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : ""}`;
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error("Failed to load practice problems");
        return r.json() as Promise<{ problems: Problem[] }>;
      });
    },
    enabled: !!practiceProblemsUrl,
    staleTime: 10 * 60_000,
  });

  const problems = (data?.problems ?? []).slice(0, 2);
  const currentProblem = problems[problemIndex];

  useEffect(() => {
    onCurrentProblemChange?.(currentProblem ?? null);
  }, [currentProblem, onCurrentProblemChange]);

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

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30, delay: 0.1 }}
      className="fixed top-20 left-6 z-[61]"
    >
      <div className="w-[360px] rounded-xl bg-card/95 backdrop-blur-sm shadow-lg border overflow-hidden max-h-[calc(100vh-200px)] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">
            {isLoading || !currentProblem
              ? "Practice"
              : `Practice ${problemIndex + 1} of ${problems.length}`}
          </span>
          {!isLoading && problems.length > 0 && (
            <div className="flex-1 mx-3 h-1.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-athena-amber rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(problemIndex / Math.max(problems.length, 1)) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8">
            <motion.div
              animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Sparkles className="h-6 w-6 text-athena-amber" />
            </motion.div>
            <p className="text-xs text-muted-foreground">Preparing practice problems…</p>
          </div>
        ) : !practiceProblemsUrl || isError || problems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8">
            {(isError || (!practiceProblemsUrl && !isLoading)) && (
              <p className="text-xs text-muted-foreground">No practice problems available.</p>
            )}
            <Button variant="outline" size="sm" onClick={onComplete}>
              Skip Practice
            </Button>
          </div>
        ) : currentProblem ? (
          <PracticeGradientCard
            problem={currentProblem}
            questionNumber={problemIndex + 1}
            onCorrect={handleCorrect}
            onExhausted={handleExhausted}
          />
        ) : null}
      </div>
    </motion.div>
  );
}
