"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReviewItem } from "./review-item";
import type { Problem } from "./types";

type ResultsScreenProps = {
  problems: Problem[];
  answers: Map<string, number>;
  wrongCounts: Map<string, number>;
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
  wrongCounts,
  score,
  elapsed,
  onRetry,
  onClose,
  onPractice,
  aiSummary,
}: ResultsScreenProps) {
  const total = problems.length;
  const pct = Math.round((score / total) * 100);

  // Weak = skipped/missed (no answer or -1) OR answered but struggled first
  // (wrong_count > 0). Aggregate by conceptTags, fallback to difficulty. The
  // two buckets are tracked separately so counts stay distinguishable.
  const weakAreas = useMemo(() => {
    const counts = new Map<string, { skipped: number; struggled: number }>();
    for (const p of problems) {
      const sel = answers.get(p.id);
      const skipped = sel === undefined || sel === -1;
      const struggled = !skipped && (wrongCounts.get(p.id) ?? 0) > 0;
      if (!skipped && !struggled) continue;
      const labels =
        p.conceptTags && p.conceptTags.length > 0
          ? p.conceptTags
          : [`${p.difficulty} problems`];
      for (const l of labels) {
        const c = counts.get(l) ?? { skipped: 0, struggled: 0 };
        if (skipped) c.skipped += 1;
        else c.struggled += 1;
        counts.set(l, c);
      }
    }
    return [...counts.entries()]
      .map(([label, c]) => ({ label, ...c, total: c.skipped + c.struggled }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [problems, answers, wrongCounts]);

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
        {weakAreas.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h3 className="text-sm font-semibold">Weak Areas</h3>
              <span className="text-xs text-muted-foreground">
                Concepts to review
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {weakAreas.map(({ label, skipped, struggled }) => (
                <span
                  key={label}
                  className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium capitalize text-destructive"
                >
                  {label.replace(/-/g, " ")}
                  {struggled > 0 && (
                    <span
                      title="Struggled before solving"
                      className="rounded-full bg-destructive/20 px-1.5 text-[10px] font-bold"
                    >
                      {struggled}
                    </span>
                  )}
                  {skipped > 0 && (
                    <span
                      title="Skipped / missed"
                      className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground"
                    >
                      {skipped}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="rounded-full bg-destructive/20 px-1.5 font-bold text-destructive">
                  #
                </span>
                struggled
              </span>
              <span className="flex items-center gap-1">
                <span className="rounded-full bg-muted px-1.5 font-bold">#</span>
                skipped
              </span>
            </div>
          </motion.div>
        )}

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
