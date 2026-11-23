"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type TopicTrend = {
  name: string;
  slug: string;
  subject: string;
  sessionCount: number;
  earlierAccuracy: number;
  latestAccuracy: number;
  delta: number;
  direction: "improving" | "declining" | "stable";
};

const DIRECTION_CONFIG = {
  improving: { icon: TrendingUp, className: "text-athena-success", sign: "+" },
  declining: { icon: TrendingDown, className: "text-destructive", sign: "" },
  stable: { icon: Minus, className: "text-muted-foreground", sign: "" },
} as const;

export function TopicTrends({ trends }: { trends: TopicTrend[] }) {
  return (
    <div className="border bg-card p-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Topic Trends Over Time
      </h2>

      {trends.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Complete a few more quizzes per topic to see how each one is trending.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {trends.map((t) => {
            const cfg = DIRECTION_CONFIG[t.direction];
            const Icon = cfg.icon;
            return (
              <li key={t.slug} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.earlierAccuracy}% → {t.latestAccuracy}% · {t.sessionCount} sessions
                  </p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums",
                    cfg.className
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.direction === "stable" ? "Stable" : `${cfg.sign}${t.delta} pts`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
