"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { CpaExamProvider } from "@/components/cpa-exam/cpa-exam-provider";
import type {
  CpaSectionExamProblem,
  CpaSectionExamAnswer,
  CpaSectionExamAttempt,
  CpaSectionExam,
} from "@/types/cpa-exam";

type LoadedData = {
  attempt: CpaSectionExamAttempt;
  test: CpaSectionExam;
  problems: CpaSectionExamProblem[];
  answers: CpaSectionExamAnswer[];
};

export default function CpaExamAttemptLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ attemptId: string }>();
  const router = useRouter();
  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Find the attempt (and its section) from the user's history.
        const historyRes = await fetch("/api/practice-exam/history");
        if (!historyRes.ok) {
          router.push("/practice-exam");
          return;
        }
        const historyJson = await historyRes.json();
        const attemptSummary = (historyJson.attempts ?? []).find(
          (a: CpaSectionExamAttempt) => a.id === params.attemptId
        );

        if (!attemptSummary) {
          router.push("/practice-exam");
          return;
        }

        // Resuming: /start returns the existing in-progress attempt for the section.
        const res = await fetch("/api/practice-exam/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: attemptSummary.section }),
        });

        if (!res.ok) {
          router.push("/practice-exam");
          return;
        }

        const json = await res.json();
        setData({
          attempt: {
            ...attemptSummary,
            id: json.attemptId,
            testId: json.test.id,
          },
          test: json.test,
          problems: json.problems,
          answers: json.answers,
        });
      } catch {
        toast.error("Failed to load exam");
        router.push("/practice-exam");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.attemptId, router]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <CpaExamProvider
      attempt={data.attempt}
      test={data.test}
      problems={data.problems}
      initialAnswers={data.answers}
    >
      {children}
    </CpaExamProvider>
  );
}
