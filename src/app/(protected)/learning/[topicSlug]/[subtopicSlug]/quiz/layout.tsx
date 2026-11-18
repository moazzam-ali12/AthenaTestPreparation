"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QuizLayoutProvider, type CheckedAnswer } from "@/components/learning/quiz/quiz-layout-provider";
import { HIDDEN_ANSWER, type AnswerReveal, type Problem } from "@/components/quiz/types";
import { isCpaSubject } from "@/types/cpa-exam";
import { upgradeReasonFromBody, withLockedParam } from "@/components/trial/upgrade-modal-provider";
import { announceOverallLevelUp } from "@/lib/adaptive/announce-level-up";

type PageData = {
  topic: { slug: string; name: string; subject: string };
  subtopic: { id: string; slug: string; name: string };
  /** No answer data in the payload — revealed per question by /api/act-quiz/answer. */
  problems: Omit<Problem, keyof AnswerReveal>[];
  struggling: boolean;
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ topicSlug: string; subtopicSlug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<PageData>({
    // Own cache entry: only `mode=quiz` serves question content to trial users,
    // so the subtopic overview (same prefix) never shares it.
    queryKey: ["learning", params.topicSlug, params.subtopicSlug, "quiz"],
    queryFn: async () => {
      const r = await fetch(`/api/learning/${params.topicSlug}/${params.subtopicSlug}?mode=quiz`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body.error ?? "Failed to load"), { status: r.status, body });
      }
      return r.json();
    },
    staleTime: 600_000,
    // The quiz indexes problems by position and the server draws a new set
    // per attempt — never swap the set out from under an in-progress quiz.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Grades one answer server-side; a trial user's first answer to a new MCQ
  // counts against the section quota (402 → global upgrade modal → null).
  const { mutateAsync: checkAnswer } = useMutation({
    mutationFn: async (vars: { problemId: string; selectedOption: number }): Promise<CheckedAnswer | null> => {
      const r = await fetch("/api/act-quiz/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (r.status === 402) return null;
      if (!r.ok) throw new Error("Failed to check answer");
      return r.json();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["trial"] }),
  });

  const problems = useMemo<Problem[]>(
    () => (data?.problems ?? []).map((p) => ({ ...HIDDEN_ANSWER, ...p })),
    [data?.problems]
  );

  useEffect(() => {
    if (isError) {
      const { status, body } = error as Error & { status?: number; body?: unknown };
      const overview = `/learning/${params.topicSlug}/${params.subtopicSlug}`;
      if (status === 402) {
        // Trial gate: the overview opens the upgrade modal from `?locked=<reason>`.
        router.replace(withLockedParam(overview, upgradeReasonFromBody(body) ?? "mcq"));
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to load quiz");
      router.push(overview);
    }
  }, [isError, error, router, params.topicSlug, params.subtopicSlug]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const subtopicId = data.subtopic.id;

  return (
    <QuizLayoutProvider
      problems={problems}
      topicName={data.topic.name}
      subtopicName={data.subtopic.name}
      subject={isCpaSubject(data.topic.subject) ? data.topic.subject : undefined}
      subtopicId={subtopicId}
      struggling={data.struggling}
      basePath={`/learning/${params.topicSlug}/${params.subtopicSlug}`}
      practiceProblemsUrl={`/api/learning/${params.topicSlug}/${params.subtopicSlug}/practice-problems`}
      checkAnswer={(problemId, selectedOption) => checkAnswer({ problemId, selectedOption })}
      onSaveResults={async ({ score, totalQuestions, timeElapsedSeconds, answers, events }) => {
        const res = await fetch("/api/act-quiz/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subtopicId,
            score,
            totalQuestions,
            timeElapsedSeconds,
            answers,
            events,
          }),
        });
        if (!res.ok) throw new Error("Failed to save results");
        queryClient.invalidateQueries({ queryKey: ["progress"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["trial"] });
        // Mark stale without refetching now (the results screen still uses
        // this set); the next quiz mount draws a fresh one.
        queryClient.invalidateQueries({
          queryKey: ["learning", params.topicSlug, params.subtopicSlug],
          refetchType: "none",
        });
        const data = await res.json();
        announceOverallLevelUp(data.overallLevelUp);
        return { newBadges: data.newBadges ?? [], rankUp: data.rankUp ?? null, reveals: data.reveals };
      }}
    >
      {children}
    </QuizLayoutProvider>
  );
}
