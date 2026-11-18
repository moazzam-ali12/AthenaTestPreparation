"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { MathContent } from "./math-content";
import type { SolutionStep } from "./types";

type SolutionWalkthroughProps = {
  explanation: string;
  solutionSteps: SolutionStep[];
  /**
   * When true, render as an opt-in collapsible reveal (used mid-quiz so a stuck
   * learner can choose to see the worked solution without it spoiling a retry).
   * When false (default), render always-expanded — used on the post-quiz review.
   */
  collapsible?: boolean;
  triggerLabel?: string;
  className?: string;
};

function WalkthroughBody({
  explanation,
  solutionSteps,
}: Pick<SolutionWalkthroughProps, "explanation" | "solutionSteps">) {
  return (
    <div className="space-y-3">
      {explanation && (
        <div className="rounded-md bg-muted p-3 space-y-2">
          <p className="text-sm font-medium">Explanation</p>
          <MathContent content={explanation} />
        </div>
      )}

      {solutionSteps.length > 0 && (
        <div className="rounded-md bg-muted p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <ListOrdered className="h-4 w-4" />
            Step-by-step solution
          </p>
          <ol className="space-y-1.5">
            {solutionSteps.map((step) => (
              <li key={step.step} className="text-sm text-muted-foreground">
                <span className="font-medium">{step.step}.</span>{" "}
                {step.instruction}
                {step.math && (
                  <code className="ml-1 text-xs font-mono">{step.math}</code>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function SolutionWalkthrough({
  explanation,
  solutionSteps,
  collapsible = false,
  triggerLabel = "Show step-by-step solution",
  className,
}: SolutionWalkthroughProps) {
  const [open, setOpen] = useState(false);

  // Nothing to show — render nothing so callers don't need to guard.
  if (!explanation && solutionSteps.length === 0) return null;

  if (!collapsible) {
    return (
      <div className={className}>
        <WalkthroughBody explanation={explanation} solutionSteps={solutionSteps} />
      </div>
    );
  }

  return (
    <div className={cn("mt-3", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-1.5">
          <ListOrdered className="h-4 w-4 text-primary" />
          {triggerLabel}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <WalkthroughBody explanation={explanation} solutionSteps={solutionSteps} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
