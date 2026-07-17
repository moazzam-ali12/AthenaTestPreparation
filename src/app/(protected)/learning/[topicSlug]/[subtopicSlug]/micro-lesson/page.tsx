"use client";

import { useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { MicroLesson } from "@/components/learning/micro-lesson";
import type { Problem } from "@/components/quiz/types";
import { WhiteboardSkeleton } from "@/components/whiteboard/whiteboard-skeleton";
import { GenerationProgress } from "@/components/lessons/generation-progress";

const HARDCODED_PROBLEMS: Problem[] = [
  {
    id: "hardcoded-linear-eq-1",
    orderIndex: 0,
    difficulty: "medium",
    questionText:
      "The equation y = -2x - 1 is graphed in the xy-plane. What is the slope and y-intercept of the line?",
    options: [
      "Slope: -2, y-intercept: -1",
      "Slope: -1, y-intercept: -2",
      "Slope: 2, y-intercept: -1",
      "Slope: -2, y-intercept: 1",
    ],
    correctOption: 0,
    explanation:
      "In the slope-intercept form y = mx + b, the coefficient of x is the slope (m = -2) and the constant term is the y-intercept (b = -1).",
    solutionSteps: [
      { step: 1, instruction: "Identify the slope-intercept form", math: "y = mx + b" },
      { step: 2, instruction: "Read off the slope", math: "m = -2" },
      { step: 3, instruction: "Read off the y-intercept", math: "b = -1" },
    ],
    hint: "Compare the equation to the slope-intercept form y = mx + b.",
    timeRecommendationSeconds: 30,
  },
  {
    id: "hardcoded-linear-eq-2",
    orderIndex: 1,
    difficulty: "medium",
    questionText:
      "The equation y = 5x + 5 is graphed in the xy-plane. At what point does the line cross the x-axis?",
    options: ["(-1, 0)", "(0, 5)", "(1, 0)", "(5, 0)"],
    correctOption: 0,
    explanation:
      "The line crosses the x-axis when y = 0. Setting 0 = 5x + 5 and solving gives x = -1, so the x-intercept is (-1, 0).",
    solutionSteps: [
      { step: 1, instruction: "Set y = 0 to find the x-intercept", math: "0 = 5x + 5" },
      { step: 2, instruction: "Subtract 5 from both sides", math: "-5 = 5x" },
      { step: 3, instruction: "Divide both sides by 5", math: "x = -1" },
    ],
    hint: "The x-axis is where y = 0. Plug that in and solve for x.",
    timeRecommendationSeconds: 45,
  },
];

export default function MicroLessonPage() {
  const params = useParams<{ topicSlug: string; subtopicSlug: string }>();
  const router = useRouter();
  const { topicSlug, subtopicSlug } = params;

  // Once we start generating locally, stop polling so the refetch
  // doesn't unmount MicroLesson by switching to the "generating" spinner.
  const generatingLocallyRef = useRef(false);

  const {
    data,
    isLoading: metaLoading,
    isError: metaError,
    error: metaErrorObj,
  } = useQuery({
    queryKey: ["learning", topicSlug, subtopicSlug],
    queryFn: async () => {
      const r = await fetch(`/api/learning/${topicSlug}/${subtopicSlug}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load");
      }
      return r.json();
    },
    staleTime: 600_000,
  });

  const {
    data: storedLesson,
    isLoading: lessonLoading,
    isError: lessonError,
  } = useQuery({
    queryKey: ["micro-lesson", topicSlug, subtopicSlug],
    queryFn: () =>
      fetch(`/api/learning/${topicSlug}/${subtopicSlug}/micro-lesson`).then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 0,
    refetchInterval: (query) => {
      if (generatingLocallyRef.current) return false;
      return query.state.data?.status === "generating" ? 3000 : false;
    },
  });

  // Stable metadata identity so <MicroLesson>'s generate effect doesn't re-fire
  // on every render (see use-micro-lesson generateLesson deps).
  const subtopicMeta = data?.subtopic;
  const metadata = useMemo(
    () =>
      subtopicMeta
        ? {
            description: subtopicMeta.description,
            learningObjectives: subtopicMeta.learningObjectives,
            keyFormulas: subtopicMeta.keyFormulas,
            commonMistakes: subtopicMeta.commonMistakes,
            tipsAndTricks: subtopicMeta.tipsAndTricks,
            conceptualOverview: subtopicMeta.conceptualOverview,
          }
        : {},
    [subtopicMeta]
  );

  useEffect(() => {
    if (metaError) {
      toast.error(metaErrorObj instanceof Error ? metaErrorObj.message : "Failed to load subtopic");
      router.push(`/learning/${topicSlug}`);
    }
  }, [metaError, metaErrorObj, router, topicSlug]);

  useEffect(() => {
    if (lessonError) toast.error("Failed to load lesson");
  }, [lessonError]);

  if (metaLoading || lessonLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (!data) return null;

  // Another client is currently generating — show polling spinner
  // (but not if we're the one generating)
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

  const { topic, subtopic } = data;

  // Determine existing lesson: ready rows pass content; null/stale/error → generate
  const existingLesson =
    storedLesson?.status === "ready"
      ? { lessonContent: storedLesson.lessonContent, whiteboardSteps: storedLesson.whiteboardSteps }
      : null;

  // If no existing lesson, we'll generate locally — stop polling
  if (!existingLesson) {
    generatingLocallyRef.current = true;
  }

  return (
    <MicroLesson
      topic={topic.name}
      subtopic={subtopic.name}
      metadata={metadata}
      existingLesson={existingLesson}
      subtopicApiPath={`/api/learning/${topicSlug}/${subtopicSlug}/micro-lesson`}
      practiceMode={{ subject: "math" }}
      practiceProblems={subtopicSlug === "linear-equations-two-variables" ? HARDCODED_PROBLEMS : undefined}
      onClose={() => router.push(`/learning/${topicSlug}/${subtopicSlug}`)}
      tracking={storedLesson?.id ? { microLessonId: storedLesson.id, subtopicId: storedLesson.subtopicId ?? data.subtopic.id } : undefined}
    />
  );
}
