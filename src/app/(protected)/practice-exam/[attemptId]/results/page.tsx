"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trophy, XCircle, ArrowRight, ClipboardCheck } from "lucide-react";
import { CPA_PASSING_SCORE } from "@/lib/cpa-scoring";
import { PRICING_PATH } from "@/lib/trial";
import { useCpaExamAttempt } from "@/hooks/use-cpa-exam";
import { ExamReviewSection } from "@/components/cpa-exam/exam-review-section";

type Results = {
  section: string;
  rawScore: number;
  scaledScore: number;
  total: number;
  passed: boolean;
  isSample: boolean;
};

export default function CpaExamResultsPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string }>();
  // Loaded by attempt ID (shared cache with the attempt layout) — refresh-safe, never calls /start.
  const { data, isLoading: loading, isFetching } = useCpaExamAttempt(params.attemptId);
  const results: Results | null =
    data && data.attempt.status === "completed" && data.scaledScore != null
      ? {
          section: data.attempt.section,
          rawScore: data.rawScore ?? 0,
          scaledScore: data.scaledScore,
          total: data.total,
          passed: data.passed ?? false,
          isSample: data.isSample,
        }
      : null;

  if (loading || (!results && isFetching)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">Result not found.</p>
        <button
          onClick={() => router.push("/practice-exam")}
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to Practice Exams
        </button>
      </div>
    );
  }

  // Sample tests are practice only: no pass/fail verdict.
  const scoreColor = results.isSample
    ? "text-primary"
    : results.passed
      ? "text-green-500"
      : "text-red-500";
  const barColor = results.isSample ? "bg-primary" : results.passed ? "bg-green-500" : "bg-red-500";
  const totalQuestions = results.total;

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
              {results.isSample ? (
                <ClipboardCheck className="h-10 w-10 text-primary" />
              ) : results.passed ? (
                <Trophy className="h-10 w-10 text-amber-500" />
              ) : (
                <XCircle className="h-10 w-10 text-red-500" />
              )}
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {results.section} {results.isSample ? "Sample Test" : "Practice Exam"} Complete
          </h1>
          {!results.isSample && (
            <p className={`mt-2 text-lg font-semibold ${scoreColor}`}>
              {results.passed ? "Passed" : "Not Passed"}
            </p>
          )}
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
            {results.rawScore}/{totalQuestions}
          </p>
          <p className="text-xs text-muted-foreground mt-1">questions correct</p>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${(results.scaledScore / 99) * 100}%` }}
            />
          </div>
        </motion.div>

        {results.isSample && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center sm:flex-row sm:text-left"
          >
            <p className="flex-1 text-sm">
              This is a short sample. Full-length timed mock exams are included in Pro.
            </p>
            <Link
              href={PRICING_PATH}
              className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              View Plans
            </Link>
          </motion.div>
        )}

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

        {/* Loaded after the score; the review API only answers for submitted attempts. */}
        <ExamReviewSection attemptId={params.attemptId} />
      </div>
    </div>
  );
}
