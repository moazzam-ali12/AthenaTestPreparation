"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, Zap, ChevronRight } from "lucide-react";
import { useQuestContext } from "./quest-context";

export function QuestCanvasScreen() {
  const ctx = useQuestContext();
  const [showExtras, setShowExtras] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const [displayXp, setDisplayXp] = useState(0);

  const targetXp = ctx.completionData?.xpEarned ?? ctx.xpEarned;
  // Stagger delay: all tiles finish animating, then a small pause
  const afterTilesMs = ctx.problems.length * 80 + 400;

  useEffect(() => {
    const t1 = setTimeout(() => setShowExtras(true), afterTilesMs);
    const t2 = setTimeout(() => setShowButton(true), afterTilesMs + 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [afterTilesMs]);

  // XP counter animation
  useEffect(() => {
    if (targetXp === 0) return;
    const t = setTimeout(() => {
      const steps = 40;
      const inc = targetXp / steps;
      let current = 0;
      const interval = setInterval(() => {
        current = Math.min(current + inc, targetXp);
        setDisplayXp(Math.round(current));
        if (current >= targetXp) clearInterval(interval);
      }, 30);
      return () => clearInterval(interval);
    }, afterTilesMs + 100);
    return () => clearTimeout(t);
  }, [targetXp, afterTilesMs]);

  const accuracy =
    ctx.problems.length > 0
      ? Math.round((ctx.score / ctx.problems.length) * 100)
      : 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 overflow-y-auto">
      <div className="w-full max-w-lg space-y-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Quest Review
          </p>
          <h1 className="text-3xl font-bold">
            {accuracy >= 80
              ? "Excellent!"
              : accuracy >= 60
                ? "Well done!"
                : "Quest Complete"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ctx.score} of {ctx.problems.length} correct · {accuracy}% accuracy
          </p>
        </motion.div>

        {/* Problem grid */}
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {ctx.problems.map((p, i) => {
            const correct = ctx.lockedIds.has(p.id) || p.isCorrect === true;
            return (
              <motion.div
                key={p.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  delay: i * 0.08,
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                }}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-2 ${
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-destructive/40 bg-destructive/10"
                }`}
              >
                {correct ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="text-[10px] text-muted-foreground">{i + 1}</span>
              </motion.div>
            );
          })}
        </div>

        {/* XP reveal + section scores */}
        <AnimatePresence>
          {showExtras && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="space-y-4"
            >
              {/* XP */}
              <div className="flex items-center justify-center gap-3 rounded-xl border border-athena-amber/30 bg-athena-amber/10 px-6 py-4">
                <Zap className="h-6 w-6 text-athena-amber" />
                <span className="text-3xl font-bold text-athena-amber">
                  +{displayXp} XP
                </span>
              </div>

              {/* Section scores — appear only once completionData arrives */}
              <AnimatePresence>
                {ctx.completionData && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2"
                  >
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      ACT Scores
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["english", "reading", "math", "science"] as const).map((s) => (
                        <div
                          key={s}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <span className="text-sm capitalize">{s}</span>
                          <span className="text-sm font-bold">
                            {ctx.completionData!.scores[s]}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                      <span className="text-sm font-medium">Composite</span>
                      <span className="text-sm font-bold text-primary">
                        {ctx.completionData.scores.composite}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Continue button */}
        <AnimatePresence>
          {showButton && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              onClick={ctx.advanceToResults}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              See Full Results
              <ChevronRight className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
