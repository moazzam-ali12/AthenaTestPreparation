"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkillLevel } from "@/components/shared/skill-level";
import { difficultyFloor, getSectionLevels, MAX_LEVEL } from "@/lib/adaptive/engine";
import type { CpaSection } from "@/types/cpa-exam";

type SubsectionSkillLike = {
  /** Runtime value is a CPA section code (AUD/FAR/REG/BAR/ISC/TCP). */
  sectionCategory: string;
  level: number;
  totalAttempts: number;
  correctAttempts: number;
};

export function CpaSectionSkills({
  skills,
  overallLevel,
  sections,
  subtopicCounts,
}: {
  skills: SubsectionSkillLike[];
  overallLevel: number;
  /** The candidate's sections: AUD, FAR, REG + their discipline. */
  sections: CpaSection[];
  subtopicCounts: Partial<Record<CpaSection, number>>;
}) {
  const sectionLevels = getSectionLevels(skills, sections, subtopicCounts);
  const maxedCount = sectionLevels.filter((s) => s.maxed).length;
  const floor = difficultyFloor(overallLevel);

  return (
    <div className="border bg-card p-5 h-full">
      <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        CPA Section Skills
      </h2>

      <div className="mb-3 border-b border-border/40 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Overall level</span>
          <span className="text-2xl font-bold tabular-nums">{overallLevel}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Get all {sections.length} sections to level {MAX_LEVEL}, practicing at least half of
          each section&apos;s subtopics, to reach overall level {overallLevel + 1}.{" "}
          <span className="font-medium text-foreground">
            {maxedCount} / {sections.length} done
          </span>
        </p>
        {floor !== "easy" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Questions start at <span className="font-medium text-foreground">{floor}</span> difficulty at this level.
          </p>
        )}
      </div>

      <div className="space-y-0">
        {sectionLevels.map(({ section, level, practicedSubtopics, totalSubtopics, requiredSubtopics, maxed }) => {
          const sectionSkills = skills.filter((s) => s.sectionCategory === section);
          const total = sectionSkills.reduce((sum, s) => sum + s.totalAttempts, 0);
          const correct = sectionSkills.reduce((sum, s) => sum + s.correctAttempts, 0);
          const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
          return (
            <div key={section} className="border-b border-border/40 py-2.5 last:border-0">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    total === 0 && "text-muted-foreground"
                  )}
                >
                  {section}
                  {maxed && <Check className="h-3.5 w-3.5 text-primary" aria-label="Section complete" />}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {total > 0 ? `${accuracy}% (${correct}/${total})` : "Not started"}
                </span>
              </div>
              {level !== null && (
                <SkillLevel level={level} overallLevel={overallLevel} className="mt-1.5" />
              )}
              {totalSubtopics > 0 && (
                <p
                  className={cn(
                    "mt-1 text-[11px] tabular-nums",
                    practicedSubtopics >= requiredSubtopics ? "text-muted-foreground" : "text-athena-amber"
                  )}
                >
                  {practicedSubtopics} / {totalSubtopics} subtopics practiced
                  {practicedSubtopics < requiredSubtopics && ` (need ${requiredSubtopics})`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
