"use client";

import Link from "next/link";
import { FileText, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { useCpaExamStatus } from "@/hooks/use-cpa-exam";
import { CPA_CORE_SECTIONS, CPA_DISCIPLINE_SECTIONS, type CpaSection } from "@/types/cpa-exam";

function SectionChip({ section }: { section: CpaSection }) {
  const { data: status, isLoading } = useCpaExamStatus(section);
  const passed = status?.progress?.passed ?? false;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        passed
          ? "border-green-500/40 bg-green-500/10 text-green-500"
          : "border-border bg-muted/50 text-muted-foreground"
      }`}
    >
      {isLoading ? (
        <span className="h-3 w-3 animate-pulse rounded-full bg-muted" />
      ) : passed ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <Circle className="h-3 w-3" />
      )}
      {section}
    </span>
  );
}

export function CpaExamCard() {
  return (
    <Link
      href="/practice-exam"
      className="block rounded-xl border bg-card p-5 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">CPA Practice Exams</p>
          <p className="text-xs text-muted-foreground">
            Take a section practice exam &mdash; pass at 75
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...CPA_CORE_SECTIONS, ...CPA_DISCIPLINE_SECTIONS].map((section) => (
          <SectionChip key={section} section={section} />
        ))}
      </div>
    </Link>
  );
}
