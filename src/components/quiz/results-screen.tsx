"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReviewItem } from "./review-item";
import type { Problem } from "./types";

type ResultsScreenProps = {
  problems: Problem[];
  answers: Map<string, number>;
  score: number;
  elapsed: number;
  onRetry: () => void;
  onClose?: () => void;
  onPractice?: () => void;
  aiSummary?: { greeting: string; summary: string; encouragement: string };
};

export function ResultsScreen({
  problems,
  answers,
  score,
  elapsed,
  onRetry,
  onClose,
  onPractice,
  aiSummary,
}: ResultsScreenProps) {
  const total = problems.length;
  const pct = Math.round((score / total) * 100);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Score header */}
      <div className="flex flex-col items-center gap-3 border-b py-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className={cn(
            "text-6xl font-bold",
            pct >= 80
              ? "text-athena-success"
              : pct >= 50
                ? "text-athena-amber"
                : "text-destructive"
          )}
        >
          {score}/{total}
        </motion.div>
        <p className="text-lg text-muted-foreground">{pct}% correct</p>
        <p className="text-sm text-muted-foreground">
          Time: {formatTime(elapsed)}
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Button variant="outline" onClick={onRetry}>
            Retry Quiz
          </Button>
          {onPractice && (
            <Button onClick={onPractice}>
              Practice 2 More Problems
            </Button>
          )}
          {onClose && !onPractice && (
            <Button onClick={onClose}>Close</Button>
          )}
        </div>
      </div>

      {/* AI tutor summary */}
      {aiSummary && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mx-auto max-w-lg px-6 py-4 text-center"
        >
          <p className="text-sm text-muted-foreground">{aiSummary.summary}</p>
          <p className="mt-2 text-xs font-medium text-athena-amber">
            {aiSummary.encouragement}
          </p>
        </motion.div>
      )}

      {/* Question review list */}
      <div className="flex-1 overflow-y-auto p-6">
        <h3 className="mb-4 text-lg font-semibold">Question Review</h3>
        <div className="space-y-4">
          {problems.map((problem, i) => (
            <motion.div
              key={problem.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <ReviewItem
                problem={problem}
                index={i}
                selectedOption={answers.get(problem.id)}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
