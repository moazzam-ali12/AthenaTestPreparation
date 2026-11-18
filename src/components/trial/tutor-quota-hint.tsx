"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccess, useTrialUsage } from "@/hooks/use-trial";
import { cn } from "@/lib/utils";

/**
 * Subtle "x of 20 tutor messages left today" line for trial users. Renders
 * nothing for Pro. `refreshKey` should change once a tutor reply settles
 * (null while streaming) so the count refetches after the server charged it.
 */
export function TutorQuotaHint({ refreshKey, className }: { refreshKey: number | null; className?: string }) {
  const { tier } = useAccess();
  const { data } = useTrialUsage();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (refreshKey) queryClient.invalidateQueries({ queryKey: ["trial"] });
  }, [refreshKey, queryClient]);

  const tutor = data?.tutor;
  if (tier !== "trial" || !tutor) return null;
  return (
    <p className={cn("text-[11px] text-muted-foreground", className)}>
      {tutor.remaining} of {tutor.limit} tutor messages left today
    </p>
  );
}
