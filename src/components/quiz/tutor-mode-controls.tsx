"use client";

import Link from "next/link";
import { HelpCircle, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { TUTOR_MODES, TUTOR_MODE_LABELS, type PracticeLink, type TutorMode } from "@/lib/tutor-modes";

type TutorModeControlsProps = {
  mode: TutorMode;
  onModeChange: (mode: TutorMode) => void;
  /** Shown after a wrong answer. */
  onWhyWrong?: () => void;
  practiceLinks: PracticeLink[];
  disabled?: boolean;
};

/** Hint · Guided · Full explanation segmented control + "Why was I wrong?" and its practice links. */
export function TutorModeControls({ mode, onModeChange, onWhyWrong, practiceLinks, disabled }: TutorModeControlsProps) {
  return (
    <div className="px-4 pt-2 space-y-2" data-testid="tutor-mode-controls">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Tutor mode"
          className="inline-flex rounded-full border bg-muted/60 p-0.5 text-xs"
        >
          {TUTOR_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={disabled}
              onClick={() => onModeChange(m)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors disabled:opacity-60",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {TUTOR_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {onWhyWrong && (
          <button
            type="button"
            onClick={onWhyWrong}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            <HelpCircle className="h-3.5 w-3.5" /> Why was I wrong?
          </button>
        )}
      </div>
      {practiceLinks.length > 0 && (
        <div className="flex flex-col gap-1" aria-label="Follow-up practice">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Try these next</span>
          {practiceLinks.map((l, i) => (
            <Link
              key={l.id}
              href={l.href}
              target="_blank"
              rel="noopener"
              data-testid="practice-link"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Dumbbell className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Practice {i + 1}: {l.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
