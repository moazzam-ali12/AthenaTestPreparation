"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useMyLearningTopic } from "@/hooks/use-my-learning-topic";
import { MicroLesson } from "@/components/learning/micro-lesson";
import { WhiteboardSkeleton } from "@/components/whiteboard/whiteboard-skeleton";
import { GenerationProgress } from "@/components/lessons/generation-progress";

export default function MyLearningMicroLessonPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const { data, isLoading } = useMyLearningTopic(params.topicId);

  const lessonApiPath = `/api/my-learning/topics/${params.topicId}/micro-lesson`;

  // Once we start generating locally, stop polling so the refetch doesn't
  // unmount MicroLesson by switching back to the "generating" spinner.
  const generatingLocallyRef = useRef(false);

  const {
    data: storedLesson,
    isLoading: lessonLoading,
    isError: lessonError,
  } = useQuery({
    queryKey: ["my-learning-micro-lesson", params.topicId],
    queryFn: () =>
      fetch(lessonApiPath).then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 0,
    refetchInterval: (query) => {
      if (generatingLocallyRef.current) return false;
      return query.state.data?.status === "generating" ? 3000 : false;
    },
  });

  useEffect(() => {
    if (lessonError) toast.error("Failed to load lesson");
  }, [lessonError]);

  const topic = data?.topic;

  // Stable metadata identity so <MicroLesson>'s generate effect doesn't re-fire
  // on every render (see use-micro-lesson generateLesson deps).
  const metadata = useMemo(
    () =>
      topic
        ? {
            description: topic.description,
            learningObjectives: topic.learningObjectives,
            tipsAndTricks: topic.tipsAndTricks,
            commonMistakes: topic.commonMistakes,
          }
        : {},
    [topic]
  );

  if (isLoading || lessonLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!data || !topic) return null;

  // Another client is currently generating — show polling spinner.
  if (storedLesson?.status === "generating" && !generatingLocallyRef.current) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-center py-6">
          <GenerationProgress />
        </div>
        <div className="flex-1 min-h-0">
          <WhiteboardSkeleton className="h-full" />
        </div>
      </div>
    );
  }

  // Ready rows hydrate from cache; null/stale/error → generate (and save back).
  const existingLesson =
    storedLesson?.status === "ready"
      ? { lessonContent: storedLesson.lessonContent, whiteboardSteps: storedLesson.whiteboardSteps }
      : null;

  if (!existingLesson) {
    generatingLocallyRef.current = true;
  }

  return (
    <MicroLesson
      topic={topic.title}
      subtopic={topic.title}
      metadata={metadata}
      existingLesson={existingLesson}
      subtopicApiPath={lessonApiPath}
      streamUrl="/api/my-learning/lesson/stream"
      chatStreamUrl="/api/my-learning/lesson/chat/stream"
      practiceMode={{ quizStreamUrl: "/api/my-learning/quiz-chat/stream" }}
      onClose={() => router.push(`/my-learning/${params.topicId}`)}
    />
  );
}
