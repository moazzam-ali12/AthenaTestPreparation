"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MathContent } from "@/components/quiz/math-content";
import { SolutionWalkthrough } from "@/components/quiz/solution-walkthrough";
import { useCpaExamReview } from "@/hooks/use-cpa-exam";
import type { CpaExamReviewQuestion } from "@/types/cpa-exam";

type Filter = "all" | "incorrect" | "skipped";

const FILTERS: { key: Filter; label: string; match: (q: CpaExamReviewQuestion) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "incorrect", label: "Incorrect", match: (q) => q.userAnswer !== null && !q.isCorrect },
  { key: "skipped", label: "Skipped", match: (q) => q.userAnswer === null },
];

/** "Review answers" for a submitted practice exam / sample test. */
export function ExamReviewSection({ attemptId }: { attemptId: string }) {
  const { data, isLoading, isError } = useCpaExamReview(attemptId, true);
  const [filter, setFilter] = useState<Filter>("all");

  const questions = data?.questions ?? [];
  const active = FILTERS.find((f) => f.key === filter)!;
  const visible = questions.filter(active.match);

  return (
    <section aria-labelledby="exam-review-title" className="mt-10">
      <h2 id="exam-review-title" className="text-lg font-semibold">
        Review answers
      </h2>

      {isLoading ? (
        <div className="mt-4 flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-muted border-t-primary" />
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm text-muted-foreground">Couldn&apos;t load the answer review.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Filter questions" className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const count = questions.filter(f.match).length;
              const selected = f.key === filter;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-3">
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No questions here.</p>
            ) : (
              visible.map((q) => <ReviewCard key={q.id} question={q} />)
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ReviewCard({ question: q }: { question: CpaExamReviewQuestion }) {
  const [open, setOpen] = useState(false);
  const skipped = q.userAnswer === null;
  const status = skipped
    ? { label: "Skipped", Icon: MinusCircle, cls: "text-muted-foreground" }
    : q.isCorrect
      ? { label: "Correct", Icon: CheckCircle2, cls: "text-athena-success" }
      : { label: "Incorrect", Icon: XCircle, cls: "text-destructive" };
  const bodyId = `review-q-${q.id}`;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="text-sm font-bold">Q{q.number}</span>
        <span className={cn("flex items-center gap-1 text-xs font-medium", status.cls)}>
          <status.Icon className="h-4 w-4" aria-hidden />
          {status.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {[q.subtopicName, q.difficulty].filter(Boolean).join(" · ")}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div id={bodyId} className="space-y-3 border-t p-4">
          <MathContent content={q.stem} />
          <ul className="space-y-1.5">
            {q.options.map((option, i) => {
              const isCorrect = i === q.correctAnswer;
              const isChosen = i === q.userAnswer;
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                    isCorrect && "border-athena-success/40 bg-athena-success/10",
                    isChosen && !isCorrect && "border-destructive/40 bg-destructive/10"
                  )}
                >
                  {isCorrect ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-athena-success" aria-hidden />
                  ) : isChosen ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  ) : (
                    <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-medium">{String.fromCharCode(65 + i)}.</span>{" "}
                    <MathContent content={option} />
                  </span>
                  {(isCorrect || isChosen) && (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {isCorrect && isChosen ? "Your answer · Correct" : isCorrect ? "Correct answer" : "Your answer"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <SolutionWalkthrough
            explanation={q.explanation}
            solutionSteps={q.solutionSteps.map((s) => ({ ...s, math: s.math ?? "" }))}
          />
        </div>
      )}
    </div>
  );
}
