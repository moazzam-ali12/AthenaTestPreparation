"use client";

import { useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  PracticeGradientCard,
  type PracticeProblem,
  type ServerGrade,
} from "@/components/quiz/practice-gradient-card";

type TutorPracticeCardProps = {
  practiceProblemsUrl?: string;
  difficulty?: string;
  /** Practice index to start at (resuming after the refresher card). */
  startIndex?: number;
  onComplete: () => void;
  /**
   * A practice problem was missed twice (answer revealed). `nextIndex` is the
   * next unanswered practice problem, or null if this was the last one.
   */
  onNeedsMicroLesson: (nextIndex: number | null) => void;
  onCurrentProblemChange?: (problem: PracticeProblem | null) => void;
};

export function TutorPracticeCard({
  practiceProblemsUrl,
  difficulty,
  startIndex = 0,
  onComplete,
  onNeedsMicroLesson,
  onCurrentProblemChange,
}: TutorPracticeCardProps) {
  // Fixed per mount: the tutor page remounts with a new startIndex to resume.
  const problemIndex = startIndex;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tutor-practice-card", practiceProblemsUrl, difficulty],
    queryFn: () => {
      if (!practiceProblemsUrl) return Promise.resolve({ problems: [] });
      const url = `${practiceProblemsUrl}${difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : ""}`;
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error("Failed to load practice problems");
        return r.json() as Promise<{ problems: PracticeProblem[] }>;
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
    onNeedsMicroLesson(problemIndex + 1 < problems.length ? problemIndex + 1 : null);
  }, [problemIndex, problems.length, onNeedsMicroLesson]);

  // Server-graded practice: POST the answer to the same endpoint that served it.
  const gradeUrl = practiceProblemsUrl?.split("?")[0];
  const gradeAnswer = useCallback(
    async (problemId: string, selectedOption: number, reveal: boolean): Promise<ServerGrade> => {
      if (!gradeUrl) throw new Error("No grader");
      const r = await fetch(gradeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problemId, selectedOption, reveal }),
      });
      if (!r.ok) throw new Error("Failed to check answer");
      return r.json();
    },
    [gradeUrl]
  );

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
            gradeAnswer={gradeAnswer}
          />
        ) : null}
      </div>
    </motion.div>
  );
}
