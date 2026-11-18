"use client";

import type { TbsSectionProgress } from "@/lib/db/queries/tbs";

/** Basic TBS progress: completed simulations and average score per section. */
export function TbsProgressCard({ progress }: { progress: TbsSectionProgress[] }) {
  return (
    <div className="border bg-card p-5">
      <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Task-Based Simulations
      </h2>
      {progress.length === 0 ? (
        <p className="text-sm text-muted-foreground">No simulations completed yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {progress.map((p) => (
            <div key={p.section} className="border p-3">
              <p className="text-xs font-semibold uppercase">{p.section}</p>
              <p className="mt-1 text-lg font-bold">{p.averagePercent}%</p>
              <p className="text-xs text-muted-foreground">
                avg · {p.completed} completed
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
