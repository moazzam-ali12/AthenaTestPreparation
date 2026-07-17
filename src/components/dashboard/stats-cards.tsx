"use client";

import type { CpaSection } from "@/types/cpa-exam";

export function StatsCards({
  targetDisciplineSection,
  sessionsCount,
}: {
  targetDisciplineSection: CpaSection | null;
  sessionsCount: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="border bg-card p-4">
        <p className="text-2xl font-bold tabular-nums">
          {targetDisciplineSection ?? "\u2014"}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Discipline
        </p>
      </div>
      <div className="border bg-card p-4">
        <p className="text-2xl font-bold tabular-nums">{sessionsCount}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </p>
      </div>
    </div>
  );
}
