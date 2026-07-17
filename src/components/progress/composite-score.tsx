"use client";

import { motion } from "framer-motion";
import type { CpaSection } from "@/types/cpa-exam";

/**
 * Replaces the old ACT "composite score" dial. CPA has no composite —
 * candidates pass or fail each section independently, so this shows how
 * many of the sections relevant to this candidate (3 mandatory core
 * sections + their chosen discipline) have been passed.
 */
export function SectionsPassedSummary({
  sectionsPassed,
  sectionsTotal,
  targetDisciplineSection,
}: {
  sectionsPassed: number;
  sectionsTotal: number;
  targetDisciplineSection: CpaSection | null;
}) {
  const pct = sectionsTotal > 0 ? Math.min((sectionsPassed / sectionsTotal) * 100, 100) : 0;

  return (
    <div className="border bg-card p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Sections Passed
          </p>
          <span className="text-5xl font-bold tabular-nums tracking-tight">
            {sectionsPassed}
          </span>
          <span className="ml-1 text-xl text-muted-foreground">/ {sectionsTotal}</span>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Discipline
          </p>
          <span className="text-2xl font-bold tabular-nums tracking-tight">
            {targetDisciplineSection ?? "—"}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-3 w-full overflow-hidden bg-muted">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {sectionsPassed >= sectionsTotal && sectionsTotal > 0
          ? "All sections passed!"
          : `${sectionsTotal - sectionsPassed} section${sectionsTotal - sectionsPassed === 1 ? "" : "s"} left to pass`}
      </p>
    </div>
  );
}
