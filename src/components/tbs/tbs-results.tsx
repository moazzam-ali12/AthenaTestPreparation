"use client";

import Link from "next/link";
import { CheckCircle2, RotateCcw, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathContent } from "@/components/quiz/math-content";
import type { TbsField, TbsSubmitResponse } from "@/lib/tbs/schema";

export function TbsResults({
  result,
  fields,
  section,
  onRetry,
}: {
  result: TbsSubmitResponse;
  fields: TbsField[];
  section: string;
  onRetry: () => void;
}) {
  const labels = new Map(fields.map((f) => [f.id, f.label]));
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="border bg-card p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your score</p>
        <p className="mt-2 text-4xl font-bold">{result.percent}%</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {result.score} / {result.maxScore} points · {result.passed ? "Passed" : "Below 75%"}
        </p>
        {result.xpEarned > 0 && (
          <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-athena-amber">
            <Zap className="h-4 w-4" /> +{result.xpEarned} XP
          </p>
        )}
      </div>

      <div className="divide-y border bg-card">
        {result.fieldResults.map((r) => (
          <div key={r.fieldId} className="flex gap-3 p-4">
            {r.correct ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{labels.get(r.fieldId) ?? r.fieldId}</p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {r.earned}/{r.possible}
                </span>
              </div>
              {!r.correct && r.expected && (
                <p className="mt-1 break-words text-muted-foreground">
                  Correct answer: <span className="text-foreground">{r.expected}</span>
                </p>
              )}
              {r.note && <p className="mt-1 text-xs text-amber-500">{r.note}</p>}
            </div>
          </div>
        ))}
      </div>

      {result.explanation && (
        <div className="border bg-card p-5">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Explanation
          </h2>
          <MathContent content={result.explanation} />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" /> Retry
        </Button>
        <Button asChild>
          <Link href={`/learning?section=${section}#simulations`}>Try another</Link>
        </Button>
      </div>
    </div>
  );
}
