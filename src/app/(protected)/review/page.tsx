"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { AlertTriangle, BookOpen, TrendingUp, Target, ChevronRight, BarChart2, Zap } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import Link from "next/link";

type StuckPoint = {
  subtopicId: string;
  subtopicName: string;
  subtopicSlug: string;
  topicName: string;
  topicSlug: string;
  stuckScore: number;
  metrics: {
    accuracy: number;
    wrongRate: number;
    hintRate: number;
    tutorRate: number;
    avgResponseTimeMs: number;
    totalAttempts: number;
    recentTrend: number;
    microLessonCompleted: boolean;
  };
  recommendation: "micro-lesson" | "practice" | "review-quiz";
};

type ReviewData = {
  stuckPoints: StuckPoint[];
  summary: {
    totalSubtopicsAttempted: number;
    stuckCount: number;
    strongCount: number;
    needsAttentionCount: number;
  };
};

const RECOMMENDATION_CONFIG = {
  "micro-lesson": {
    label: "Take Micro-Lesson",
    icon: BookOpen,
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  "review-quiz": {
    label: "Review Quiz",
    icon: BarChart2,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  practice: {
    label: "More Practice",
    icon: Zap,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
};

function AccuracyBar({ accuracy }: { accuracy: number }) {
  const color =
    accuracy >= 80 ? "bg-green-500" : accuracy >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${accuracy}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

function StuckCard({ point, index }: { point: StuckPoint; index: number }) {
  const rec = RECOMMENDATION_CONFIG[point.recommendation];
  const RecIcon = rec.icon;
  const href =
    point.recommendation === "micro-lesson"
      ? `/learning/${point.topicSlug}/${point.subtopicSlug}/micro-lesson`
      : `/learning/${point.topicSlug}/${point.subtopicSlug}/quiz/1`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-xl border bg-card p-4 hover:border-muted-foreground/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5 truncate">{point.topicName}</p>
          <p className="font-semibold truncate">{point.subtopicName}</p>
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Accuracy</span>
              <span
                className={`text-xs font-medium ${
                  point.metrics.accuracy >= 80
                    ? "text-green-400"
                    : point.metrics.accuracy >= 50
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {point.metrics.accuracy}%
              </span>
            </div>
            <AccuracyBar accuracy={point.metrics.accuracy} />
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{point.metrics.totalAttempts} attempts</span>
            {point.metrics.hintRate > 30 && (
              <span className="text-amber-400">Hint-heavy</span>
            )}
            {point.metrics.recentTrend >= 4 && (
              <span className="text-red-400">Declining</span>
            )}
          </div>
        </div>
        <Link href={href}>
          <div
            className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${rec.bg} ${rec.color}`}
          >
            <RecIcon className="h-3 w-3" />
            {rec.label}
            <ChevronRight className="h-3 w-3" />
          </div>
        </Link>
      </div>
    </motion.div>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const { data: userData, loading: userLoading } = useCurrentUser();

  const enabled = !userLoading && !!userData && userData.user.onboardingCompleted;

  const { data, isLoading, isError } = useQuery<ReviewData>({
    queryKey: ["review"],
    queryFn: () =>
      fetch("/api/analytics/stuck-points").then((r) => {
        if (!r.ok) throw new Error("Failed to load review data");
        return r.json();
      }),
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!userLoading && userData && !userData.user.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [userLoading, userData, router]);

  useEffect(() => {
    if (isError) toast.error("Failed to load review data");
  }, [isError]);

  const stuckPoints = data?.stuckPoints ?? [];
  const summary = data?.summary;

  const weakTopics = stuckPoints.filter((p) => p.stuckScore > 3);
  const needsAttention = stuckPoints.filter(
    (p) => p.stuckScore <= 3 && p.metrics.accuracy < 80
  );
  const strongTopics = stuckPoints.filter((p) => p.metrics.accuracy >= 80);

  // Group weak topics by subject
  const groupedWeak = weakTopics.reduce<Record<string, StuckPoint[]>>((acc, p) => {
    if (!acc[p.topicName]) acc[p.topicName] = [];
    acc[p.topicName].push(p);
    return acc;
  }, {});

  return (
    <div className="relative p-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-2xl font-bold tracking-tight">Review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weakness patterns and personalized recommendations
          </p>
        </motion.div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
            {[
              {
                label: "Topics Attempted",
                value: summary.totalSubtopicsAttempted,
                icon: Target,
                color: "text-blue-400",
              },
              {
                label: "Need Work",
                value: summary.stuckCount,
                icon: AlertTriangle,
                color: "text-red-400",
              },
              {
                label: "Needs Attention",
                value: summary.needsAttentionCount,
                icon: TrendingUp,
                color: "text-amber-400",
              },
              {
                label: "Strong",
                value: summary.strongCount,
                icon: Zap,
                color: "text-green-400",
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-xl border bg-card p-4"
                >
                  <Icon className={`h-4 w-4 mb-2 ${card.color}`} />
                  <p className="text-2xl font-bold">{isLoading ? "—" : card.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
                </motion.div>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && stuckPoints.length === 0 && (
          <div className="rounded-xl border bg-card p-10 text-center">
            <BookOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">No review data yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Complete some quizzes to see your weakness patterns here.
            </p>
            <Link href="/learning" className="inline-block mt-4 text-sm text-primary underline">
              Start learning
            </Link>
          </div>
        )}

        {/* Weak topics grouped by subject */}
        {weakTopics.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h2 className="font-semibold">Needs Work</h2>
              <span className="text-xs text-muted-foreground">({weakTopics.length} subtopics)</span>
            </div>
            <div className="space-y-6">
              {Object.entries(groupedWeak).map(([topicName, points]) => (
                <div key={topicName}>
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                    {topicName}
                  </p>
                  <div className="space-y-2">
                    {points.map((p, i) => (
                      <StuckCard key={p.subtopicId} point={p} index={i} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Needs attention */}
        {needsAttention.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              <h2 className="font-semibold">Needs Attention</h2>
              <span className="text-xs text-muted-foreground">({needsAttention.length} subtopics)</span>
            </div>
            <div className="space-y-2">
              {needsAttention.map((p, i) => (
                <StuckCard key={p.subtopicId} point={p} index={i} />
              ))}
            </div>
          </section>
        )}

        {/* Strong topics */}
        {strongTopics.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-green-400" />
              <h2 className="font-semibold">Strong Areas</h2>
              <span className="text-xs text-muted-foreground">({strongTopics.length} subtopics)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {strongTopics.map((p) => (
                <div
                  key={p.subtopicId}
                  className="rounded-xl border bg-card p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">{p.topicName}</p>
                    <p className="text-sm font-medium">{p.subtopicName}</p>
                  </div>
                  <span className="text-sm font-bold text-green-400">{p.metrics.accuracy}%</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
