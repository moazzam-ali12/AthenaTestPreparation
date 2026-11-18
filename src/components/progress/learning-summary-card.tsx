"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, TrendingUp, TrendingDown, Minus, ArrowRight, Target } from "lucide-react";

type LearningSummary = {
  headline: string;
  narrative: string[];
  focusArea: {
    subtopicName: string;
    topicName: string;
    topicSlug: string;
    subtopicSlug: string;
    accuracy: number;
    recommendation: "micro-lesson" | "practice" | "review-quiz";
  } | null;
  strength: { subtopicName: string; accuracy: number } | null;
  trend: "improving" | "stable" | "declining";
  overallAccuracy: number;
  subtopicsAttempted: number;
};

const TREND_CONFIG = {
  improving: { label: "Improving", icon: TrendingUp, className: "text-athena-success" },
  stable: { label: "Stable", icon: Minus, className: "text-muted-foreground" },
  declining: { label: "Declining", icon: TrendingDown, className: "text-destructive" },
};

const CTA_LABEL: Record<NonNullable<LearningSummary["focusArea"]>["recommendation"], string> = {
  "micro-lesson": "Start micro-lesson",
  practice: "Practice now",
  "review-quiz": "Review quiz",
};

export function LearningSummaryCard() {
  const { data } = useQuery<LearningSummary>({
    queryKey: ["learning-summary"],
    queryFn: () =>
      fetch("/api/progress/summary").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 60_000,
  });

  if (!data) return null;

  const trend = TREND_CONFIG[data.trend];
  const TrendIcon = trend.icon;

  return (
    <div className="border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Your Learning Summary
        </h2>
        <span className={`flex items-center gap-1 text-xs font-semibold ${trend.className}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {trend.label}
        </span>
      </div>

      <p className="mt-3 text-lg font-bold">{data.headline}</p>

      <div className="mt-2 space-y-1.5">
        {data.narrative.map((line, i) => (
          <p key={i} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
      </div>

      {data.focusArea && (
        <Link
          href={`/learning/${data.focusArea.topicSlug}/${data.focusArea.subtopicSlug}`}
          className="mt-4 flex items-center justify-between gap-3 border bg-muted/40 p-3 transition-colors hover:bg-muted"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-primary" />
            Focus: {data.focusArea.subtopicName}
            <span className="text-muted-foreground">({data.focusArea.accuracy}%)</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
            {CTA_LABEL[data.focusArea.recommendation]}
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}
    </div>
  );
}
