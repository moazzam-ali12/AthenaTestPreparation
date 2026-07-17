"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { AnimatedSprite } from "@/components/pixel-art/animated-sprite";
import { ProfileNameEditor } from "@/components/profile/profile-name-editor";
import { ProfileStreak } from "@/components/profile/profile-streak";
import { CpaSectionHistory } from "@/components/profile/cpa-section-history";
import { ScheduleEditor } from "@/components/profile/schedule-editor";
import { BadgesSection } from "@/components/profile/badges-section";
import type { Badge } from "@/lib/badges";
import type { CpaSection, CpaSectionStatusEntry } from "@/types/cpa-exam";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { NotificationToggle } from "@/components/settings/notification-toggle";

type TierInfo = {
  name: string;
  threshold: number;
  weapon: string;
  emoji: string;
  active: boolean;
};

type StreakDay = {
  day: string;
  completed: boolean;
  isPast: boolean;
};

type ProfileData = {
  user: {
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string;
    targetDisciplineSection: CpaSection | null;
    bestStreak: number;
  } | null;
  totalScore: number;
  totalXp: number;
  questsDone: number;
  totalTimeSeconds: number;
  accuracy: number;
  streak: number;
  bestStreak: number;
  sectionProgress: CpaSectionStatusEntry[];
  weeklyStreakDays: StreakDay[];
  badges: Badge[];
  rank: {
    current: { name: string; weapon: string; emoji: string; threshold: number };
    next: { name: string; weapon: string; emoji: string; threshold: number } | null;
    pct: number;
    pointsToNext: number;
  };
  tiers: TierInfo[];
};

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProfilePage() {
  const router = useRouter();
  const { data: userData, loading: userLoading } = useCurrentUser();

  const readyToLoad =
    !userLoading && !!userData && userData.user.onboardingCompleted;

  const {
    data,
    isLoading: profileLoading,
    isError,
  } = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () =>
      fetch("/api/profile").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 2 * 60_000,
    enabled: readyToLoad,
  });

  useEffect(() => {
    if (!userLoading && userData && !userData.user.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [userData, userLoading, router]);

  useEffect(() => {
    if (isError) toast.error("Failed to load profile data");
  }, [isError]);

  const loading = userLoading || profileLoading;

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="h-8 w-48 bg-muted animate-pulse" />
        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_280px]">
          <div className="space-y-8">
            <div className="h-20 bg-muted animate-pulse" />
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 gap-x-16 gap-y-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-muted animate-pulse" />
              ))}
            </div>
            <div className="h-px bg-border" />
            <div className="h-20 bg-muted animate-pulse" />
          </div>
          <div className="space-y-6">
            <div className="h-20 bg-muted animate-pulse" />
            <div className="h-64 bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!data || !data.user) return null;

  const { user, totalScore, totalXp, questsDone, totalTimeSeconds, accuracy, rank, tiers, badges } = data;
  const bestStreak = Math.max(data.bestStreak, data.streak);

  return (
    <div className="relative z-10 p-6">
      <motion.div
        className="mx-auto max-w-5xl"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {/* Page title */}
        <motion.h1
          variants={staggerItem}
          className="mb-8 text-2xl font-bold tracking-tight"
        >
          Hero Profile
        </motion.h1>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_280px]">
          {/* Left column — main content */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {/* Hero header */}
            <motion.div variants={staggerItem} className="flex items-start gap-4">
              <AnimatedSprite
                src="/images/pixel-art/profile-avatar.png"
                alt="Avatar"
                width={64}
                height={64}
              />

              <div className="min-w-0 flex-1">
                <ProfileNameEditor displayName={user.displayName} />
                <p className="text-sm text-muted-foreground">
                  Quest started {formatDate(user.createdAt)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {rank.current.emoji} {rank.current.name} — {rank.current.weapon}
                </p>
              </div>
            </motion.div>

            {/* Divider */}
            <div className="my-8 border-b" />

            {/* Stats grid */}
            <motion.div variants={staggerItem}>
              <div className="grid grid-cols-2 gap-x-16 gap-y-8 sm:grid-cols-3">
                <div>
                  <p className="text-2xl font-bold">{questsDone}</p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Quests Done
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatTime(totalTimeSeconds)}</p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Time
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{bestStreak} days</p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Best Streak
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{accuracy}%</p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Accuracy
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    <span className="text-yellow-500">⚡</span> {totalXp ?? 0}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total XP
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Divider */}
            <div className="my-8 border-b" />

            {/* Streak section */}
            <motion.div variants={staggerItem}>
              <ProfileStreak
                streak={data.streak}
                bestStreak={bestStreak}
                weeklyStreakDays={data.weeklyStreakDays}
              />
            </motion.div>

            {/* Divider */}
            <div className="my-8 border-b" />

            {/* Badges */}
            <motion.div variants={staggerItem}>
              <BadgesSection badges={badges} />
            </motion.div>

            {/* Divider */}
            <div className="my-8 border-b" />

            {/* CPA Section History */}
            <motion.div variants={staggerItem}>
              <CpaSectionHistory sections={data.sectionProgress} />
            </motion.div>

            {/* Divider */}
            <div className="my-8 border-b" />

            {/* Progress to next tier */}
            <motion.div variants={staggerItem}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Progress to Next Tier
              </h3>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-2xl font-bold">
                  {rank.next?.threshold ?? totalScore}
                </span>
                <span className="text-sm text-muted-foreground">
                  Currently {totalScore}
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden bg-muted">
                <motion.div
                  className="h-full bg-foreground"
                  initial={{ width: 0 }}
                  animate={{ width: `${rank.pct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
              </div>
              {rank.next && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {rank.pointsToNext} points to {rank.next.name}
                </p>
              )}
            </motion.div>
          </motion.div>

          {/* Right column — sidebar */}
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {/* Schedule editor */}
            <motion.div variants={staggerItem}>
              <ScheduleEditor />
            </motion.div>

            {/* Current tier card */}
            <motion.div
              variants={staggerItem}
              className="mt-4 border bg-card p-4"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Current Tier
              </h3>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-2xl">{rank.current.emoji}</span>
                <div>
                  <p className="font-semibold">{rank.current.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {rank.current.weapon}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* All tiers list */}
            <motion.div
              variants={staggerItem}
              className="mt-4 border bg-card p-4"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                All Tiers
              </h3>
              <div className="mt-3 space-y-1">
                {tiers.map((tier) => (
                  <div
                    key={tier.name}
                    className={`flex items-center gap-2.5 py-1.5 text-sm ${
                      tier.active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground/50"
                    }`}
                  >
                    <span className="text-base">{tier.emoji}</span>
                    <span className="flex-1">{tier.name}</span>
                    <span className="tabular-nums">{tier.threshold}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            {/* Billing & notifications */}
            <motion.div
              variants={staggerItem}
              className="mt-4 border bg-card p-4 space-y-3"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Account
              </h3>
              <Link
                href="/billing"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Billing & Plan
              </Link>
              <NotificationToggle />
            </motion.div>
          </motion.div>
        </div>

        {/* Journey section — full width */}
        <motion.div variants={staggerItem} className="mt-10">
          <div className="flex gap-6 overflow-x-auto pb-2">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`flex shrink-0 flex-col items-center gap-1 ${
                  tier.active ? "opacity-100" : "opacity-30"
                }`}
              >
                <span className="text-2xl">{tier.emoji}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
