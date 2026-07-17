"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trophy, Zap, Clock, Target, ArrowRight, Flame } from "lucide-react";
import { useQuestContext } from "./quest-context";
import { UnlockCelebration } from "@/components/shared/unlock-celebration";

export function QuestResultsScreen() {
  const router = useRouter();
  const ctx = useQuestContext();
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);

  const accuracy = ctx.problems.length > 0
    ? Math.round((ctx.score / ctx.problems.length) * 100)
    : 0;

  const minutes = Math.floor(ctx.elapsed / 60);
  const seconds = ctx.elapsed % 60;

  const cd = ctx.completionData;
  const displayXp = cd?.xpEarned ?? ctx.xpEarned;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 overflow-y-auto">
      {cd && !celebrationDismissed && (
        <UnlockCelebration
          newBadges={cd.newBadges}
          rankUp={cd.rankUp}
          onDismiss={() => setCelebrationDismissed(true)}
        />
      )}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.5 }}
        className="w-full max-w-md space-y-6"
      >
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Quest Complete!</h1>
          <p className="mt-1 text-muted-foreground">
            {accuracy >= 80
              ? "Outstanding performance!"
              : accuracy >= 60
                ? "Good effort, keep pushing!"
                : "Every quest makes you stronger."}
          </p>
        </div>

        {/* Streak banner */}
        {cd && cd.streak > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-2 rounded-lg border border-athena-amber/40 bg-athena-amber/10 px-4 py-3"
          >
            <Flame className="h-5 w-5 text-athena-amber" />
            <span className="font-semibold text-athena-amber">
              {cd.streak} day streak!
            </span>
          </motion.div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border bg-card p-4 text-center">
            <Target className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-2xl font-bold">{ctx.score}/{ctx.problems.length}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center flex flex-col items-center justify-center">
            <p className="text-2xl font-bold text-primary">{accuracy}%</p>
            <p className="text-xs text-muted-foreground mt-1">Accuracy</p>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center">
            <Clock className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-2xl font-bold">{minutes}:{seconds.toString().padStart(2, "0")}</p>
            <p className="text-xs text-muted-foreground">Time</p>
          </div>
          <div className="rounded-lg border bg-card p-4 text-center">
            <Zap className="mx-auto mb-2 h-5 w-5 text-athena-amber" />
            <p className="text-2xl font-bold text-athena-amber">+{displayXp}</p>
            <p className="text-xs text-muted-foreground">XP Earned</p>
          </div>
        </div>

        {/* Section scores (from API) */}
        {cd && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="space-y-2"
          >
            <h3 className="text-sm font-medium text-muted-foreground">ACT Section Scores</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["english", "reading", "science", "math"] as const).map((section) => (
                <div key={section} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm capitalize">{section}</span>
                  <span className="text-sm font-bold">{cd.scores[section]}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">Composite</span>
              <span className="text-sm font-bold text-primary">{cd.scores.composite}</span>
            </div>
          </motion.div>
        )}

        {/* Bucket breakdown */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Performance by Focus</h3>
          {(["weak", "mid", "stretch"] as const).map((bucket) => {
            const bucketProblems = ctx.problems.filter((p) => p.bucket === bucket);
            if (bucketProblems.length === 0) return null;
            const correct = bucketProblems.filter((p) => ctx.lockedIds.has(p.id) || p.isCorrect === true).length;
            const label =
              bucket === "weak" ? "Weak Areas" : bucket === "mid" ? "Mid Level" : "Stretch";
            return (
              <div key={bucket} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">{label}</span>
                <span className="text-sm font-medium">
                  {correct}/{bucketProblems.length}
                </span>
              </div>
            );
          })}
        </div>

        {/* Action */}
        <button
          onClick={() => router.push("/dashboard")}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Back to Dashboard
          <ArrowRight className="h-4 w-4" />
        </button>
      </motion.div>
    </div>
  );
}
