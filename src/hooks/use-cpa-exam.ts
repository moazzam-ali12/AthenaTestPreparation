"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEffect } from "react";
import type {
  CpaSection,
  CpaExamStatusResponse,
  CpaExamStartResponse,
  CpaExamSubmitResponse,
  CpaExamHistoryResponse,
} from "@/types/cpa-exam";

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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["cpa-exam", data.section] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
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
