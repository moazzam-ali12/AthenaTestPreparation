"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Trophy, ArrowRight } from "lucide-react";

export function QuizCompletion({
  skillScore,
  totalQuestions,
  correctCount,
  onContinue,
}: {
  skillScore: number;
  totalQuestions: number;
  correctCount: number;
  onContinue: () => void;
}) {
  const accuracy =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  const accuracyColor =
    accuracy >= 80
      ? "text-green-400"
      : accuracy >= 50
        ? "text-amber-400"
        : "text-red-400";

  const encouragement =
    accuracy >= 80
      ? "Strong start! We'll tailor your study plan to sharpen what's left."
      : accuracy >= 50
        ? "Good baseline! Daily quests will target your gaps and build from here."
        : "Great that you took the diagnostic! We'll build a focused plan to get you exam-ready.";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-lg mx-auto text-center"
    >
      <div className="rounded-2xl border bg-card p-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10"
        >
          <Trophy className="h-8 w-8 text-amber-400" />
        </motion.div>

        <h2 className="text-2xl font-bold mb-1">Diagnostic Complete!</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Here&apos;s how you did — we&apos;ll use this to build your personalized study plan.
        </p>

        {/* Result */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
            Questions Answered Correctly
          </p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className={`text-6xl font-bold ${accuracyColor}`}
          >
            {correctCount}
            <span className="text-2xl text-muted-foreground font-normal">
              /{totalQuestions}
            </span>
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-1 text-sm text-muted-foreground"
          >
            {accuracy}% accuracy · Skill score {skillScore}
          </motion.p>
        </div>

        <p className="text-sm text-muted-foreground mb-6">{encouragement}</p>

        <Button onClick={onContinue} className="w-full" size="lg">
          Set your study schedule
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}
