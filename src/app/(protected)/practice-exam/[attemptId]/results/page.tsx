"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trophy, XCircle, ArrowRight } from "lucide-react";
import { CPA_PASSING_SCORE } from "@/lib/cpa-scoring";
import { SECTION_QUESTION_COUNT } from "@/types/cpa-exam";
import type { CpaSectionExamAttempt } from "@/types/cpa-exam";

type Results = {
  section: string;
  rawScore: number;
  scaledScore: number;
  passed: boolean;
};

export default function CpaExamResultsPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      try {
        const res = await fetch("/api/practice-exam/history");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        const attempt = (data.attempts as CpaSectionExamAttempt[] | undefined)?.find(
          (a) => a.id === params.attemptId
        );
        if (attempt && attempt.status === "completed" && attempt.scaledScore != null) {
          setResults({
            section: attempt.section,
            rawScore: attempt.rawScore ?? 0,
            scaledScore: attempt.scaledScore,
            passed: attempt.passed ?? false,
          });
        }
      } catch {
        // Results may not be available yet
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, [params.attemptId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Results not available yet.</p>
        <button
          onClick={() => router.push("/practice-exam")}
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to Practice Exams
        </button>
      </div>
    );
  }

  const scoreColor = results.passed ? "text-green-500" : "text-red-500";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background overflow-auto">
      <div className="mx-auto max-w-2xl px-4 py-12 w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="mb-4 flex items-center justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              {results.passed ? (
                <Trophy className="h-10 w-10 text-amber-500" />
              ) : (
                <XCircle className="h-10 w-10 text-red-500" />
              )}
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {results.section} Practice Exam Complete
          </h1>
          <p className={`mt-2 text-lg font-semibold ${scoreColor}`}>
            {results.passed ? "Passed" : "Not Passed"}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 text-center"
        >
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
            Scaled Score
          </p>
          <p className={`text-6xl font-bold tabular-nums mt-2 ${scoreColor}`}>
            {results.scaledScore}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            out of 99 &middot; passing is {CPA_PASSING_SCORE}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-10 rounded-lg border bg-card p-5 text-center"
        >
          <p className="text-3xl font-bold tabular-nums">
            {results.rawScore}/{SECTION_QUESTION_COUNT}
          </p>
          <p className="text-xs text-muted-foreground mt-1">questions correct</p>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${results.passed ? "bg-green-500" : "bg-red-500"}`}
              style={{ width: `${(results.scaledScore / 99) * 100}%` }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <button
            onClick={() => router.push("/practice-exam")}
            className="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            Back to Practice Exams
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Dashboard
            <ArrowRight className="h-4 w-4" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
