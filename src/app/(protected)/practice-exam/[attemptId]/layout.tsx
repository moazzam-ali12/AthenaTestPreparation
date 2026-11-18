"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { CpaExamProvider } from "@/components/cpa-exam/cpa-exam-provider";
import { useCpaExamAttempt } from "@/hooks/use-cpa-exam";

export default function CpaExamAttemptLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ attemptId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  // Loads the attempt by ID — a refresh resumes the same attempt and never re-runs /start.
  const { data, isLoading, isError, isFetching } = useCpaExamAttempt(params.attemptId);

  const resultsPath = `/practice-exam/${params.attemptId}/results`;
  const onResults = pathname === resultsPath;
  const status = data?.attempt.status;

  // Submitted → results; unfinished → back into the exam. Skip while refetching
  // (e.g. right after submit) so stale data doesn't bounce the user.
  useEffect(() => {
    if (isFetching || !status) return;
    if (status === "completed" && !onResults) router.replace(resultsPath);
    else if (status === "in_progress" && onResults) router.replace(`/practice-exam/${params.attemptId}`);
  }, [isFetching, status, onResults, resultsPath, params.attemptId, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground">
          {isError ? "Couldn't load this exam." : "Result not found."}
        </p>
        <Link href="/practice-exam" className="text-sm font-medium text-primary hover:underline">
          Back to Practice Exams
        </Link>
      </div>
    );
  }

  return (
    <CpaExamProvider
      // Elapsed time is measured from started_at, so the timer continues across refreshes.
      attempt={{ ...data.attempt, totalTimeSeconds: data.elapsedSeconds }}
      test={data.test}
      problems={data.problems}
      initialAnswers={data.answers}
      durationMinutes={data.durationMinutes}
    >
      {children}
    </CpaExamProvider>
  );
}
