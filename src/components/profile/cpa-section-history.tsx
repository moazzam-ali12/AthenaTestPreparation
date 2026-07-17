"use client";

import Link from "next/link";
import { CPA_PASSING_SCORE } from "@/lib/cpa-scoring";
import type { CpaSectionStatusEntry } from "@/types/cpa-exam";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scoreColor(score: number | null, passed: boolean): string {
  if (score === null) return "text-muted-foreground";
  if (passed) return "text-green-500";
  if (score >= CPA_PASSING_SCORE - 10) return "text-amber-500";
  return "text-red-500";
}

export function CpaSectionHistory({
  sections,
}: {
  sections: CpaSectionStatusEntry[];
}) {
  const attempted = sections.filter((s) => s.attemptsCount > 0);

  if (attempted.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          CPA Section Progress
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">
          No section practice exams yet.{" "}
          <Link href="/learning" className="underline hover:text-foreground">
            Start practicing
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        CPA Section Progress
      </h3>
      <div className="mt-4 space-y-3">
        {attempted.map((s) => (
          <div
            key={s.section}
            className="flex items-center justify-between border-b border-border/40 pb-3 last:border-0"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{s.section}</span>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    s.passed
                      ? "bg-green-500/10 text-green-500"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.passed ? "Passed" : "Not passed"}
                </span>
              </div>
              {s.passedAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Passed {formatDate(s.passedAt)}
                </p>
              ) : s.lastAttemptAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last attempt {formatDate(s.lastAttemptAt)} ·{" "}
                  {s.attemptsCount} attempt{s.attemptsCount === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
            <span
              className={`text-2xl font-bold ${scoreColor(s.bestScaledScore, s.passed)}`}
            >
              {s.bestScaledScore ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
