"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type CanvasStatusDisconnected = { connected: false };
export type CanvasStatusConnected = {
  connected: true;
  canvasInstanceUrl: string;
  canvasUserName: string | null;
  selectedCourseId: string | null;
  selectedCourseName: string | null;
  selectedAssignmentId: string | null;
  selectedAssignmentName: string | null;
  lastSyncedAt: string | null;
};
export type CanvasStatus = CanvasStatusDisconnected | CanvasStatusConnected;

export type CanvasCourse = {
  id: number;
  name: string;
  course_code: string;
};

export type CanvasAssignment = {
  id: number;
  name: string;
  points_possible: number;
  submission_types: string[];
};

export function useCanvasStatus() {
  const { data, isLoading, isError } = useQuery<CanvasStatus>({
    queryKey: ["canvas-status"],
    queryFn: () =>
      fetch("/api/canvas/status").then((r) => {
        if (!r.ok) throw new Error("Failed to fetch Canvas status");
        return r.json() as Promise<CanvasStatus>;
      }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load Canvas connection status");
  }, [isError]);

  return { data, isLoading };
}

export function useCanvasCourses(enabled: boolean) {
  const { data, isLoading, isError } = useQuery<{ courses: CanvasCourse[] }>({
    queryKey: ["canvas-courses"],
    queryFn: () =>
      fetch("/api/canvas/courses").then((r) => {
        if (!r.ok) throw new Error("Failed to fetch courses");
        return r.json() as Promise<{ courses: CanvasCourse[] }>;
      }),
    enabled,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load Canvas courses");
  }, [isError]);

  return { courses: data?.courses ?? [], isLoading };
}

export function useCanvasAssignments(courseId: string | null) {
  const { data, isLoading, isError } = useQuery<{ assignments: CanvasAssignment[] }>({
    queryKey: ["canvas-assignments", courseId],
    queryFn: () =>
      fetch(`/api/canvas/assignments?courseId=${courseId}`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch assignments");
        return r.json() as Promise<{ assignments: CanvasAssignment[] }>;
      }),
    enabled: !!courseId,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load Canvas assignments");
  }, [isError]);

  return { assignments: data?.assignments ?? [], isLoading };
}

export function useCanvasDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch("/api/canvas/disconnect", { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error("Failed to disconnect");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canvas-status"] });
      qc.removeQueries({ queryKey: ["canvas-courses"] });
      qc.removeQueries({ queryKey: ["canvas-assignments"] });
      toast.success("Canvas disconnected");
    },
    onError: () => toast.error("Failed to disconnect Canvas"),
  });
}

export function useCanvasConfigure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      selectedCourseId: string;
      selectedCourseName: string;
      selectedAssignmentId: string;
      selectedAssignmentName: string;
    }) =>
      fetch("/api/canvas/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to configure");
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canvas-status"] });
      toast.success("Canvas configuration saved");
    },
    onError: () => toast.error("Failed to save Canvas configuration"),
  });
}
