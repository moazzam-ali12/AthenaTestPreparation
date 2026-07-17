"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type AccountabilityData = {
  isBlocked: boolean;
  missedQuestId: string | null;
  missedDate: string | null;
};

export function useAccountability(enabled: boolean) {
  const { data, isLoading, isError } = useQuery<AccountabilityData>({
    queryKey: ["accountability"],
    queryFn: () =>
      fetch("/api/daily-quest/accountability").then((r) => {
        if (!r.ok) throw new Error("Failed to check accountability");
        return r.json();
      }),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to check quest status");
  }, [isError]);

  return {
    isBlocked: data?.isBlocked ?? false,
    missedQuestId: data?.missedQuestId ?? null,
    missedDate: data?.missedDate ?? null,
    isLoading,
  };
}

export function useSubmitReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { questId: string; reason: string }) =>
      fetch("/api/daily-quest/accountability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to submit reset");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accountability"] });
      toast.success("You're back on track!");
    },
    onError: () => toast.error("Failed to submit recommit"),
  });
}
