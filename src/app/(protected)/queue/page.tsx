"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PartyPopper, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type NextLessonResult =
  | {
      complete: false;
      topicSlug: string;
      topicName: string;
      subtopicSlug: string;
      subtopicName: string;
      subject: string;
      difficulty: string | null;
      estimatedMinutes: number | null;
      attempted: boolean;
      bestScorePct: number | null;
      passedCount: number;
      totalCount: number;
    }
  | {
      complete: true;
      passedCount: number;
      totalCount: number;
    };

export default function QueuePage() {
  const router = useRouter();

  const { data, isLoading, isError } = useQuery<NextLessonResult>({
    queryKey: ["next-lesson"],
    queryFn: () =>
      fetch("/api/next-lesson").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load your next lesson");
  }, [isError]);

  const pct = data && data.totalCount > 0 ? Math.round((data.passedCount / data.totalCount) * 100) : 0;

  return (
    <div className="relative p-6">
      <div className="mx-auto max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold tracking-tight">Learning Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your next lesson, based on where you are in the curriculum.
          </p>
        </motion.div>

        {isLoading && (
          <div className="h-48 bg-muted animate-pulse rounded-lg" />
        )}

        {!isLoading && data && !data.complete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border bg-card p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              {data.subject.toUpperCase()} &middot; {data.topicName}
            </p>
            <h2 className="mt-2 text-xl font-bold">{data.subtopicName}</h2>

            <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
              {data.difficulty && (
                <span className="capitalize">{data.difficulty}</span>
              )}
              {data.estimatedMinutes != null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {data.estimatedMinutes} min
                </span>
              )}
            </div>

            {data.attempted && (
              <p className="mt-3 text-sm text-athena-amber">
                You scored {data.bestScorePct}% last time &mdash; you need 70% to pass and move on.
              </p>
            )}

            <div className="mt-5">
              <Button
                onClick={() => router.push(`/learning/${data.topicSlug}/${data.subtopicSlug}`)}
              >
                {data.attempted ? "Retry Subtopic" : "Start Subtopic"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Curriculum progress</span>
                <span>{data.passedCount} / {data.totalCount} passed</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}

        {!isLoading && data && data.complete && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center rounded-lg border bg-card p-12 text-center"
          >
            <PartyPopper className="h-10 w-10 text-athena-amber mb-3" />
            <p className="font-semibold">You&apos;ve passed every subtopic in your curriculum!</p>
            <p className="text-sm text-muted-foreground mt-1">
              {data.passedCount} / {data.totalCount} subtopics mastered.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
