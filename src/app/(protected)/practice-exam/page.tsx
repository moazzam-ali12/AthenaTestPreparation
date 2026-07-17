"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, ChevronLeft, Circle } from "lucide-react";
import { useCpaExamStatus, useStartCpaExam } from "@/hooks/use-cpa-exam";
import {
  CPA_CORE_SECTIONS,
  CPA_DISCIPLINE_SECTIONS,
  SECTION_QUESTION_COUNT,
  SECTION_TIME_LIMIT_SECONDS,
  type CpaSection,
} from "@/types/cpa-exam";

const SECTION_NAMES: Record<CpaSection, string> = {
  AUD: "Auditing and Attestation",
  FAR: "Financial Accounting and Reporting",
  REG: "Regulation",
  BAR: "Business Analysis and Reporting",
  ISC: "Information Systems and Controls",
  TCP: "Tax Compliance and Planning",
};

function SectionRow({ section }: { section: CpaSection }) {
  const router = useRouter();
  const { data: status, isLoading } = useCpaExamStatus(section);
  const startMutation = useStartCpaExam();

  const handleStart = async () => {
    const result = await startMutation.mutateAsync({ section });
    router.push(`/practice-exam/${result.attemptId}`);
  };

  const progress = status?.progress;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border bg-card p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{section}</h3>
            <span className="text-xs text-muted-foreground truncate">
              {SECTION_NAMES[section]}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{SECTION_QUESTION_COUNT} questions</span>
            <span>{Math.round(SECTION_TIME_LIMIT_SECONDS / 60)} min</span>
            {!isLoading && progress && (
              <span className="flex items-center gap-1">
                {progress.passed ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-500 font-medium">
                      Passed ({progress.bestScaledScore})
                    </span>
                  </>
                ) : (
                  <>
                    <Circle className="h-3.5 w-3.5" />
                    {progress.bestScaledScore != null
                      ? `Best: ${progress.bestScaledScore}/99`
                      : "Not attempted"}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {status?.currentAttempt ? (
          <button
            onClick={() => router.push(`/practice-exam/${status.currentAttempt!.id}`)}
            className="shrink-0 rounded-md border-2 border-primary bg-primary/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/10"
          >
            Resume
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={isLoading || startMutation.isPending}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startMutation.isPending ? "Starting..." : "Start"}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default function PracticeExamLandingPage() {
  const router = useRouter();
  const [disciplineTab, setDisciplineTab] = useState<CpaSection>(CPA_DISCIPLINE_SECTIONS[0]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <button
        onClick={() => router.push("/dashboard")}
        className="mb-6 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Dashboard
      </button>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-2xl font-bold tracking-tight">CPA Practice Exams</h1>
        <p className="mt-2 text-muted-foreground">
          Each CPA section is taken independently. Complete the three Core sections
          (AUD, FAR, REG), plus one Discipline section of your choice. Each practice
          exam is scored 0–99, passing at 75.
        </p>
      </motion.div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Core Sections (required)
        </h2>
        {CPA_CORE_SECTIONS.map((section) => (
          <SectionRow key={section} section={section} />
        ))}
      </div>

      <div className="mt-10 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Discipline Section (pick one)
        </h2>
        <div className="flex gap-2">
          {CPA_DISCIPLINE_SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => setDisciplineTab(section)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                disciplineTab === section
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {section}
            </button>
          ))}
        </div>
        <SectionRow section={disciplineTab} />
      </div>
    </div>
  );
}
