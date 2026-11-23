"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { featureTier, type AccessTier, type TrialUsageResponse } from "@/lib/trial";

/** Access from the cached user. `tier` is null while loading. */
export function useAccess(): {
  /**
   * Tier to gate FEATURES on: a full-mode trial user reads as "pro" (see
   * hasProFeatures), so quotas, counters and locks disappear automatically.
   */
  tier: AccessTier | null;
  /** The real tier (pro | trial | expired), for banners and billing copy. */
  accessTier: AccessTier | null;
  daysLeft: number;
  /** Days of failed-payment grace left (0 unless past_due within grace; tier stays pro). */
  graceDaysLeft: number;
  /** True once loaded and the user lacks Pro features (limited trial or expired). */
  isLimited: boolean;
} {
  const { data } = useCurrentUser();
  const accessTier: AccessTier | null = data?.access?.tier ?? null;
  const tier = featureTier(accessTier);
  return {
    tier,
    accessTier,
    daysLeft: data?.access?.daysLeft ?? 0,
    graceDaysLeft: data?.access?.graceDaysLeft ?? 0,
    isLimited: tier !== null && tier !== "pro",
  };
}

/** Per-section free-trial usage. Only fetched for non-Pro users. */
export function useTrialUsage() {
  const { isLimited } = useAccess();
  return useQuery<TrialUsageResponse>({
    queryKey: ["trial"],
    queryFn: () =>
      fetch("/api/trial").then((r) => {
        if (!r.ok) throw new Error("Failed to load trial usage");
        return r.json();
      }),
    enabled: isLimited,
    staleTime: 30_000,
  });
}
