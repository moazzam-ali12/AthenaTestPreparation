"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QuizLayoutProvider } from "@/components/learning/quiz/quiz-layout-provider";
import type { Problem } from "@/components/quiz/types";

type PageData = {
  topic: { slug: string; name: string; subject: string };
  subtopic: { id: string; slug: string; name: string };
  problems: Problem[];
  struggling: boolean;
};

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ topicSlug: string; subtopicSlug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<PageData>({
    queryKey: ["learning", params.topicSlug, params.subtopicSlug],
    queryFn: async () => {
      const r = await fetch(`/api/learning/${params.topicSlug}/${params.subtopicSlug}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load");
      }
      return r.json();
    },
    staleTime: 600_000,
  });

  useEffect(() => {
    if (isError) {
      toast.error(error instanceof Error ? error.message : "Failed to load quiz");
      router.push(`/learning/${params.topicSlug}/${params.subtopicSlug}`);
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
      problems={data.problems}
      topicName={data.topic.name}
      subtopicName={data.subtopic.name}
      subject={data.topic.subject as "english" | "math" | "reading" | "science"}
      struggling={data.struggling}
      basePath={`/learning/${params.topicSlug}/${params.subtopicSlug}`}
      practiceProblemsUrl={`/api/learning/${params.topicSlug}/${params.subtopicSlug}/practice-problems`}
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
        const data = await res.json();
        return { newBadges: data.newBadges ?? [], rankUp: data.rankUp ?? null };
      }}
    >
      {children}
    </QuizLayoutProvider>
  );
}
