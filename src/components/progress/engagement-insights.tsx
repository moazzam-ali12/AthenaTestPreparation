"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type EngagementSummary = {
  totalQuizTimeSeconds: number;
  totalLessonTimeSeconds: number;
  microLessonCompletionRate: number;
  avgHintsPerQuestion: number;
  avgTutorEntriesPerSession: number;
  fullScaffoldingCount: number;
  improvementTrend: "improving" | "stable" | "declining";
};

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const TREND_CONFIG = {
  improving: { label: "Improving", icon: TrendingUp, className: "text-athena-success" },
  stable: { label: "Stable", icon: Minus, className: "text-muted-foreground" },
  declining: { label: "Declining", icon: TrendingDown, className: "text-destructive" },
};

export function EngagementInsights() {
  const { data } = useQuery<EngagementSummary>({
    queryKey: ["engagement-summary"],
    queryFn: () =>
      fetch("/api/analytics/engagement-summary").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 60_000,
  });

  if (!data) return null;

  const trend = TREND_CONFIG[data.improvementTrend];
  const TrendIcon = trend.icon;

  return (
    <div className="border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Engagement Insights
        </h2>
        <span className={`flex items-center gap-1 text-xs font-semibold ${trend.className}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {trend.label}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Quiz Time
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {formatDuration(data.totalQuizTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Lesson Time
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums">
            {formatDuration(data.totalLessonTimeSeconds)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Lessons Completed
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums">{data.microLessonCompletionRate}%</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Avg Hints / Question
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums">{data.avgHintsPerQuestion}</p>
        </div>
      </div>
    </div>
  );
}
