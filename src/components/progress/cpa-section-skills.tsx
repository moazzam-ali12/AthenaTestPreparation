"use client";

import { cn } from "@/lib/utils";
import { CPA_SECTIONS } from "@/lib/cpa-scoring";
import type { CpaSection } from "@/types/cpa-exam";

type SubsectionSkillLike = {
  /** Runtime value is a CPA section code (AUD/FAR/REG/BAR/ISC/TCP). */
  sectionCategory: string;
  totalAttempts: number;
  correctAttempts: number;
};

export function CpaSectionSkills({
  skills,
}: {
  skills: SubsectionSkillLike[];
}) {
  const bySection = new Map<CpaSection, { total: number; correct: number; subtopics: number }>();
  for (const section of CPA_SECTIONS) {
    bySection.set(section, { total: 0, correct: 0, subtopics: 0 });
  }

  for (const skill of skills) {
    const section = skill.sectionCategory as CpaSection;
    const bucket = bySection.get(section);
    if (!bucket) continue;
    bucket.total += skill.totalAttempts;
    bucket.correct += skill.correctAttempts;
    if (skill.totalAttempts > 0) bucket.subtopics += 1;
  }

  return (
    <div className="border bg-card p-5 h-full">
      <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        CPA Section Skills
      </h2>
      <div className="space-y-0">
        {CPA_SECTIONS.map((section) => {
          const stats = bySection.get(section)!;
          const accuracy =
            stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
          return (
            <div
              key={section}
              className="flex items-center justify-between border-b border-border/40 py-2.5 last:border-0"
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  stats.total === 0 && "text-muted-foreground"
                )}
              >
                {section}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {stats.total > 0 ? `${accuracy}% (${stats.correct}/${stats.total})` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
