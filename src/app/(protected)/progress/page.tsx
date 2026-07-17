"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ProgressHeader } from "@/components/progress/progress-header";
import { SectionsPassedSummary } from "@/components/progress/composite-score";
import { ScoreHistory } from "@/components/progress/score-history";
import { StudyStats } from "@/components/progress/study-stats";
import { TopicMastery } from "@/components/progress/topic-mastery";
import { CpaSectionSkills } from "@/components/progress/cpa-section-skills";
import { PracticeTestResults } from "@/components/progress/practice-test-results";
import { EngagementInsights } from "@/components/progress/engagement-insights";
import { AccuracyByDifficultyChart } from "@/components/progress/accuracy-by-difficulty-chart";
import { SectionPerformanceChart } from "@/components/progress/section-performance-chart";
import { GoalsCard } from "@/components/progress/goals-card";
import type { CpaSection } from "@/types/cpa-exam";

type SectionData = {
  subject: string;
  total: number;
  correct: number;
  accuracy: number;
  scaledScore: number;
};

type ProgressData = {
  user: {
    displayName: string | null;
    avatarUrl: string | null;
    targetDisciplineSection: CpaSection | null;
    skillScore: number | null;
  };
  sectionsPassed: number;
  sectionsTotal: number;
  scoreHistory: { date: string; score: number }[];
  accuracyByDifficulty: {
    difficulty: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  topicPerformance: {
    name: string;
    slug: string;
    subject: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  recentSessions: {
    id: string;
    subtopicName: string;
    score: number;
    totalQuestions: number;
    timeElapsedSeconds: number;
    date: string;
  }[];
  overallStats: {
    totalQuestions: number;
    accuracy: number;
    totalTimeSeconds: number;
    sessionCount: number;
    avgScore: number;
  };
  sectionScores: {
    aud: SectionData;
    far: SectionData;
    reg: SectionData;
    bar: SectionData;
    isc: SectionData;
    tcp: SectionData;
  };
  topicMastery: {
    items: { name: string; mastered: boolean; attempted: boolean }[];
    masteredCount: number;
    totalCount: number;
  };
  subsectionSkills: {
    sectionCategory: string;
    totalAttempts: number;
    correctAttempts: number;
  }[];
};

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function ProgressPage() {
  const router = useRouter();
  const { data: userData, loading: userLoading } = useCurrentUser();

  const readyToLoad =
    !userLoading && !!userData && userData.user.onboardingCompleted;

  const {
    data,
    isLoading: progressLoading,
    isError,
  } = useQuery<ProgressData>({
    queryKey: ["progress"],
    queryFn: () =>
      fetch("/api/progress").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 60_000,
    enabled: readyToLoad,
  });

  useEffect(() => {
    if (!userLoading && userData && !userData.user.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [userData, userLoading, router]);

  useEffect(() => {
    if (isError) toast.error("Failed to load progress data");
  }, [isError]);

  const loading = userLoading || progressLoading;

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <div className="h-16 bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-40 bg-muted animate-pulse" />
          <div className="h-40 bg-muted animate-pulse" />
        </div>
        <div className="h-64 bg-muted animate-pulse" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-32 bg-muted animate-pulse" />
          <div className="h-32 bg-muted animate-pulse" />
        </div>
        <div className="h-48 bg-muted animate-pulse" />
        <div className="h-48 bg-muted animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {isError ? "Could not load progress data. Please refresh." : "No data yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative z-10 p-6">
      <motion.div
        className="mx-auto max-w-5xl space-y-6"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {/* Header */}
        <motion.div variants={staggerItem}>
          <ProgressHeader
            displayName={data.user.displayName}
            avatarUrl={data.user.avatarUrl}
          />
        </motion.div>

        {/* Sections passed summary */}
        <motion.div variants={staggerItem}>
          <SectionsPassedSummary
            sectionsPassed={data.sectionsPassed}
            sectionsTotal={data.sectionsTotal}
            targetDisciplineSection={data.user.targetDisciplineSection}
          />
        </motion.div>

        {/* Score history chart */}
        <motion.div variants={staggerItem} className="h-72">
          <ScoreHistory data={data.scoreHistory} />
        </motion.div>

        {/* Study stats + topic mastery */}
        <motion.div
          variants={staggerItem}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <StudyStats stats={data.overallStats} />
          <TopicMastery mastery={data.topicMastery} />
        </motion.div>

        {/* Engagement insights */}
        <motion.div variants={staggerItem}>
          <EngagementInsights />
        </motion.div>

        {/* Accuracy by difficulty + section performance charts */}
        <motion.div
          variants={staggerItem}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <div className="h-64">
            <AccuracyByDifficultyChart data={data.accuracyByDifficulty} />
          </div>
          <div className="h-64">
            <SectionPerformanceChart sectionScores={data.sectionScores} />
          </div>
        </motion.div>

        {/* Goals */}
        <motion.div variants={staggerItem}>
          <GoalsCard />
        </motion.div>

        {/* CPA Section Skills breakdown */}
        <motion.div variants={staggerItem}>
          <CpaSectionSkills skills={data.subsectionSkills} />
        </motion.div>

        {/* Recent practice sessions */}
        <motion.div variants={staggerItem}>
          <PracticeTestResults sessions={data.recentSessions} />
        </motion.div>
      </motion.div>
    </div>
  );
}
