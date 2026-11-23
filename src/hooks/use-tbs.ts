"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CpaSubject } from "@/types/cpa-exam";
import type {
  TbsListItem,
  TbsOpenResponse,
  TbsResponses,
  TbsSubmitResponse,
} from "@/lib/tbs/schema";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Request failed";
    throw Object.assign(new Error(message), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

export function useTbsList(section: CpaSubject, enabled = true) {
  const query = useQuery<{ section: string; tasks: TbsListItem[] }>({
    queryKey: ["tbs", "list", section],
    queryFn: () => fetch(`/api/tbs?section=${section}`).then((r) => json(r)),
    staleTime: 60_000,
    enabled,
  });
  useEffect(() => {
    if (query.isError) toast.error("Failed to load simulations");
  }, [query.isError]);
  return query;
}

/** Opens (and for trial users, consumes) a task. 402s are handled by the global upgrade modal. */
export function useTbsTask(id: string) {
  return useQuery<TbsOpenResponse>({
    queryKey: ["tbs", "task", id],
    queryFn: () => fetch(`/api/tbs/${id}`).then((r) => json(r)),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

type AttemptBody = { responses: TbsResponses; timeSpentSeconds: number };

export function useSaveTbsAttempt(id: string) {
  return useMutation({
    mutationFn: (body: AttemptBody) =>
      fetch(`/api/tbs/${id}/attempt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => json<{ ok: true; savedAt: string }>(r)),
  });
}

export function useSubmitTbs(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AttemptBody) =>
      fetch(`/api/tbs/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => json<TbsSubmitResponse>(r)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tbs", "list"] });
      queryClient.invalidateQueries({ queryKey: ["progress"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err.message || "Failed to submit simulation"),
  });
}
