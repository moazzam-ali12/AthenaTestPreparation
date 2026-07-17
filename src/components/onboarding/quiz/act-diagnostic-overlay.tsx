"use client";

import { useEffect, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathContent } from "@/components/quiz/math-content";
import { QuizCompletion } from "./quiz-completion";

type CpaCoreSection = "AUD" | "FAR" | "REG";

type DiagnosticProblem = {
  id: string;
  questionText: string;
  options: string[];
  difficultyLevel: number;
};

type DiagnosticSection = {
  section: CpaCoreSection;
  problems: DiagnosticProblem[];
};

type Answer = {
  problemId: string;
  section: CpaCoreSection;
  selectedOption: number;
};

type SubmitResult = {
  correctCount: number;
  totalQuestions: number;
  skillScore: number;
};

const SECTION_COLORS: Record<string, string> = {
  AUD: "text-blue-400",
  FAR: "text-violet-400",
  REG: "text-amber-400",
};

export function ActDiagnosticOverlay() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [globalIndex, setGlobalIndex] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const { data, isLoading, isError } = useQuery<{ sections: DiagnosticSection[] }>({
    queryKey: ["onboarding-diagnostic"],
    queryFn: () =>
      fetch("/api/onboarding/diagnostic").then((r) => {
        if (!r.ok) throw new Error("Failed to load diagnostic");
        return r.json();
      }),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load diagnostic questions");
  }, [isError]);

  // Flatten all problems in order
  const allProblems: { problem: DiagnosticProblem; section: DiagnosticSection["section"] }[] =
    (data?.sections ?? []).flatMap((s) =>
      s.problems.map((p) => ({ problem: p, section: s.section }))
    );

  const total = allProblems.length;
  const current = allProblems[globalIndex];

  const { mutate: submitDiagnostic, isPending: isSubmitting } = useMutation({
    mutationFn: (finalAnswers: Answer[]) =>
      fetch("/api/onboarding/diagnostic/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      }).then((r) => {
        if (!r.ok) throw new Error("Submit failed");
        return r.json();
      }),
    onSuccess: (data: SubmitResult) => setResult(data),
    onError: () => toast.error("Failed to submit diagnostic"),
  });

  const handleConfirm = useCallback(() => {
    if (selected == null || !current) return;
    const newAnswer: Answer = {
      problemId: current.problem.id,
      section: current.section,
      selectedOption: selected,
    };
    const updated = [...answers, newAnswer];
    setAnswers(updated);
    setConfirmed(true);

    // Auto-advance after 800ms
    setTimeout(() => {
      if (globalIndex + 1 >= total) {
        submitDiagnostic(updated);
      } else {
        setGlobalIndex((i) => i + 1);
        setSelected(null);
        setConfirmed(false);
      }
    }, 800);
  }, [selected, current, answers, globalIndex, total, submitDiagnostic]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4 overflow-y-auto">
        <QuizCompletion
          skillScore={result.skillScore}
          totalQuestions={result.totalQuestions}
          correctCount={result.correctCount}
          onContinue={() => router.push("/onboarding/schedule")}
        />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background gap-4 p-6 text-center">
        <p className="font-semibold">No diagnostic questions available yet.</p>
        <p className="text-sm text-muted-foreground">The question bank is still being seeded. Please try again in a moment.</p>
        <Button onClick={() => router.push("/onboarding/schedule")}>Skip to Schedule</Button>
      </div>
    );
  }

  const sectionIndex = (data?.sections ?? []).findIndex((s) => s.section === current.section);
  const problemInSection = (data?.sections ?? [])[sectionIndex]?.problems.findIndex(
    (p) => p.id === current.problem.id
  ) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-2xl flex items-center justify-between">
          <div>
            <span className={`text-xs font-bold uppercase tracking-widest ${SECTION_COLORS[current.section]}`}>
              {current.section}
            </span>
            <p className="text-xs text-muted-foreground">
              Question {problemInSection + 1} of {data?.sections.find((s) => s.section === current.section)?.problems.length}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{globalIndex + 1} / {total}</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mx-auto max-w-2xl mt-2">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-primary"
              animate={{ width: `${((globalIndex + 1) / total) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      </div>

      {/* Section divider */}
      {globalIndex > 0 && allProblems[globalIndex - 1]?.section !== current.section && (
        <div className="mx-auto max-w-2xl w-full px-4 pt-6">
          <div className={`rounded-xl border p-4 text-center ${SECTION_COLORS[current.section].replace("text-", "border-").replace("400", "500/30")} bg-muted/20`}>
            <p className={`text-sm font-bold ${SECTION_COLORS[current.section]}`}>
              Now: {current.section} Section
            </p>
          </div>
        </div>
      )}

      {/* Question */}
      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.problem.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="text-base font-medium leading-relaxed mb-6">
                <MathContent content={current.problem.questionText} />
              </div>

              <div className="space-y-3">
                {current.problem.options.map((opt, i) => {
                  const isSelected = selected === i;
                  const isCorrectReveal = confirmed && isSelected;
                  return (
                    <button
                      key={i}
                      disabled={confirmed}
                      onClick={() => !confirmed && setSelected(i)}
                      className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-all flex items-center gap-3 ${
                        confirmed && isSelected
                          ? "border-green-500/50 bg-green-500/10"
                          : isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-muted-foreground/40"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
                      }`}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {isCorrectReveal && <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {!confirmed && (
                <Button
                  className="w-full mt-6"
                  disabled={selected == null || isSubmitting}
                  onClick={handleConfirm}
                >
                  {isSubmitting ? "Submitting..." : globalIndex + 1 === total ? "Submit Diagnostic" : "Confirm"}
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
