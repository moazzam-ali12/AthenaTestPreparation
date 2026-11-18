"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect } from "react";
import { announceOverallLevelUp } from "@/lib/adaptive/announce-level-up";
import type {
  CpaSection,
  CpaExamStatusResponse,
  CpaExamStartResponse,
  CpaExamSubmitResponse,
  CpaExamHistoryResponse,
  CpaExamAttemptResponse,
  CpaExamReviewResponse,
} from "@/types/cpa-exam";

/** Per-question review of a submitted attempt. Enable only once the attempt is completed. */
export function useCpaExamReview(attemptId: string, enabled: boolean) {
  const query = useQuery<CpaExamReviewResponse>({
    queryKey: ["cpa-exam-review", attemptId],
    queryFn: async () => {
      const res = await fetch(`/api/practice-exam/attempts/${encodeURIComponent(attemptId)}/review`);
      if (!res.ok) throw new Error("Failed to load review");
      return res.json();
    },
    enabled: enabled && !!attemptId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (query.isError) toast.error("Failed to load answer review");
  }, [query.isError]);

  return query;
}

export const cpaExamAttemptKey = (attemptId: string) => ["cpa-exam-attempt", attemptId] as const;

/** One attempt by ID (refresh-safe; never calls /start). `null` = not found / not yours. */
export function useCpaExamAttempt(attemptId: string) {
  const query = useQuery<CpaExamAttemptResponse | null>({
    queryKey: cpaExamAttemptKey(attemptId),
    queryFn: async () => {
      const res = await fetch(`/api/practice-exam/attempts/${encodeURIComponent(attemptId)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load exam");
      return res.json();
    },
    enabled: !!attemptId,
    // The provider owns live exam state; don't refetch it out from under the timer.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.isError) toast.error("Failed to load exam");
  }, [query.isError]);

  return query;
}

export function useCpaExamStatus(section: CpaSection) {
  const { data, isLoading, isError, refetch } = useQuery<CpaExamStatusResponse>({
    queryKey: ["cpa-exam", section],
    queryFn: async () => {
      const res = await fetch(`/api/practice-exam?section=${section}`);
      if (!res.ok) throw new Error("Failed to fetch practice exam status");
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load practice exam status");
  }, [isError]);

  return { data, isLoading, isError, refetch };
}

export function useStartCpaExam() {
  const queryClient = useQueryClient();

  return useMutation<CpaExamStartResponse, Error, { section: CpaSection; testId?: string }>({
    mutationFn: async ({ section, testId }) => {
      const res = await fetch("/api/practice-exam/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, testId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start exam");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cpa-exam", variables.section] });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useAnswerCpaExam() {
  return useMutation({
    mutationFn: async (payload: {
      attemptId: string;
      problemId: string;
      module: number;
      orderIndex: number;
      selectedOption: number;
      isCorrect: boolean;
      responseTimeMs?: number;
    }) => {
      const res = await fetch("/api/practice-exam/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to record answer");
      return res.json();
    },
  });
}

export function useSubmitCpaExam() {
  const queryClient = useQueryClient();

  return useMutation<
    CpaExamSubmitResponse,
    Error,
    { attemptId: string; totalTimeSeconds: number }
  >({
    mutationFn: async (payload) => {
      const res = await fetch("/api/practice-exam/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to submit exam");
      return res.json();
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cpa-exam", data.section] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
      announceOverallLevelUp(data.overallLevelUp);
      // Awaited so the results page reads the submitted attempt, not the cached in-progress one.
      await queryClient.invalidateQueries({ queryKey: cpaExamAttemptKey(variables.attemptId) });
    },
    onError: () => {
      toast.error("Failed to submit exam");
    },
  });
}

export function useCpaExamHistory(section?: CpaSection) {
  const { data, isLoading, isError } = useQuery<CpaExamHistoryResponse>({
    queryKey: ["cpa-exam-history", section ?? "all"],
    queryFn: async () => {
      const url = section
        ? `/api/practice-exam/history?section=${section}`
        : "/api/practice-exam/history";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load exam history");
  }, [isError]);

  return { data, isLoading, isError };
}
