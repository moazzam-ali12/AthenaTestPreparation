"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRICING_PATH } from "@/lib/trial";

type PracticeRefresherCardProps = {
  onAskTutor: () => void;
  onKeepPractising: () => void;
};

/**
 * Shown instead of the micro-lesson redirect after two practice misses when the
 * user has no micro-lesson access (trial). Non-blocking: sits where the practice
 * card was, inside the tutor overlay.
 */
export function PracticeRefresherCard({ onAskTutor, onKeepPractising }: PracticeRefresherCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the card so keyboard/screen-reader users land on it.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      aria-labelledby="practice-refresher-title"
      className="fixed top-20 left-4 right-4 z-[61] sm:right-auto sm:left-6 sm:w-[360px]"
    >
      <div className="rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-athena-amber" aria-hidden />
          <h2
            id="practice-refresher-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-semibold outline-none"
          >
            Need a refresher?
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Struggling with this one? Get a step-by-step explanation from the AI tutor.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" size="sm" className="flex-1" onClick={onAskTutor}>
            Ask the AI tutor
          </Button>
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={onKeepPractising}>
            Keep practising
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          <span>
            Micro-lessons are included in Pro ·{" "}
            <Link href={PRICING_PATH} className="font-medium text-primary hover:underline">
              View Plans
            </Link>
          </span>
        </p>
      </div>
    </motion.section>
  );
}
