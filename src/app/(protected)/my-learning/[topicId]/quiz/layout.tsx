"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useMyLearningTopic } from "@/hooks/use-my-learning-topic";
import { QuizLayoutProvider } from "@/components/learning/quiz/quiz-layout-provider";
import type { Problem } from "@/components/quiz/types";

type CustomQuestion = {
  id: string;
  orderIndex: number;
  difficulty: string;
  questionText: string;
  options: string[];
  correctOption: number;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math: string }[];
  hint: string;
  timeRecommendationSeconds: number;
};

function questionsToProblems(questions: CustomQuestion[]): Problem[] {
  return questions.map((q) => ({
    id: q.id,
    orderIndex: q.orderIndex,
    difficulty: q.difficulty,
    questionText: q.questionText,
    options: q.options,
    correctOption: q.correctOption,
    explanation: q.explanation,
    solutionSteps: q.solutionSteps,
    hint: q.hint,
    timeRecommendationSeconds: q.timeRecommendationSeconds,
  }));
}

export default function MyLearningQuizLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useMyLearningTopic(params.topicId);

  useEffect(() => {
    if (isError) {
      toast.error("Failed to load quiz");
      router.push(`/my-learning/${params.topicId}`);
    }
  }, [isError, router, params.topicId]);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  const { topic, questions } = data;
  const problems = questionsToProblems(questions);
  const topicId = params.topicId;

  return (
    <QuizLayoutProvider
      problems={problems}
      topicName={topic.title}
      subtopicName={topic.title}
      basePath={`/my-learning/${topicId}`}
      practiceProblemsUrl={`/api/my-learning/topics/${topicId}/practice-problems`}
      onSaveResults={async ({ score, totalQuestions, timeElapsedSeconds, answers, events }) => {
        const res = await fetch("/api/my-learning/quiz/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topicId,
            score,
            totalQuestions,
            timeElapsedSeconds,
            answers: answers.map((a) => ({
              questionId: a.problemId,
              selectedOption: a.selectedOption,
              isCorrect: a.isCorrect,
              responseTimeMs: a.responseTimeMs,
              wrongCount: a.wrongCount,
              hintUsed: a.hintUsed,
              tutorUsed: a.tutorUsed,
              practiceCompleted: a.practiceCompleted,
            })),
            events,
          }),
        });
        if (!res.ok) throw new Error("Failed to save results");
        queryClient.invalidateQueries({ queryKey: ["progress"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }}
    >
      {children}
    </QuizLayoutProvider>
  );
}
