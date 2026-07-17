"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle, Circle, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import {
  useCanvasStatus,
  useCanvasCourses,
  useCanvasAssignments,
  useCanvasDisconnect,
  useCanvasConfigure,
  type CanvasCourse,
  type CanvasAssignment,
} from "@/hooks/use-canvas-integration";
import { cn } from "@/lib/utils";

export function CanvasIntegration() {
  const searchParams = useSearchParams();
  const { data: status, isLoading } = useCanvasStatus();
  const connected = status?.connected === true;

  const [showUrlForm, setShowUrlForm] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedCourseName, setSelectedCourseName] = useState<string | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedAssignmentName, setSelectedAssignmentName] = useState<string | null>(null);

  const { courses, isLoading: coursesLoading } = useCanvasCourses(connected);
  const { assignments, isLoading: assignmentsLoading } = useCanvasAssignments(selectedCourseId);
  const disconnect = useCanvasDisconnect();
  const configure = useCanvasConfigure();

  useEffect(() => {
    if (status?.connected) {
      setSelectedCourseId(status.selectedCourseId ?? null);
      setSelectedCourseName(status.selectedCourseName ?? null);
      setSelectedAssignmentId(status.selectedAssignmentId ?? null);
      setSelectedAssignmentName(status.selectedAssignmentName ?? null);
    }
  }, [status]);

  useEffect(() => {
    if (searchParams.get("canvas_connected") === "1") {
      toast.success("Canvas connected successfully!");
    }
    const err = searchParams.get("canvas_error");
    if (err) {
      toast.error(`Canvas connection failed: ${err.replace(/_/g, " ")}`);
    }
  }, [searchParams]);

  const handleConnect = () => {
    const url = canvasUrl.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      toast.error("Enter a valid Canvas URL (e.g. https://canvas.school.edu)");
      return;
    }
    window.location.href = `/api/canvas/oauth/authorize?canvasUrl=${encodeURIComponent(url)}`;
  };

  const handleSaveConfig = () => {
    if (!selectedCourseId || !selectedCourseName || !selectedAssignmentId || !selectedAssignmentName) {
      toast.error("Select both a course and an assignment");
      return;
    }
    configure.mutate({
      selectedCourseId,
      selectedCourseName,
      selectedAssignmentId,
      selectedAssignmentName,
    });
  };

  const isSyncing = configure.isPending;
  const configDirty =
    connected &&
    status?.connected &&
    (selectedCourseId !== status.selectedCourseId ||
      selectedAssignmentId !== status.selectedAssignmentId);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Canvas status…
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold leading-none">Canvas LMS</h3>
          <p className="text-xs text-muted-foreground mt-1.5">
            Automatically submit quest completions to your Canvas gradebook
          </p>
        </div>
        {connected ? (
          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Connected
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            Not connected
          </span>
        )}
      </div>

      {/* Not connected — connect button */}
      {!connected && !showUrlForm && (
        <button
          onClick={() => setShowUrlForm(true)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Link2 className="h-4 w-4" />
          Connect Canvas
        </button>
      )}

      {/* URL entry form */}
      {!connected && showUrlForm && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Canvas Instance URL</label>
            <input
              type="url"
              placeholder="https://canvas.school.edu"
              value={canvasUrl}
              onChange={(e) => setCanvasUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The base URL for your school's Canvas installation
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              disabled={!canvasUrl.trim()}
              className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Authorize with Canvas
            </button>
            <button
              onClick={() => { setShowUrlForm(false); setCanvasUrl(""); }}
              className="rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Connected — configuration */}
      {connected && status?.connected && (
        <div className="space-y-5">
          {/* Account info */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
            <span>
              Signed in as{" "}
              <span className="font-medium text-foreground">{status.canvasUserName ?? "Canvas User"}</span>
              {" · "}
              <span className="truncate">{status.canvasInstanceUrl}</span>
            </span>
          </div>

          {/* Course selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Course</label>
            <select
              value={selectedCourseId ?? ""}
              onChange={(e) => {
                const course = courses.find((c: CanvasCourse) => String(c.id) === e.target.value);
                setSelectedCourseId(e.target.value || null);
                setSelectedCourseName(course?.name ?? null);
                setSelectedAssignmentId(null);
                setSelectedAssignmentName(null);
              }}
              disabled={coursesLoading}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              <option value="">
                {coursesLoading ? "Loading courses…" : "Select a course"}
              </option>
              {courses.map((c: CanvasCourse) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assignment selector */}
          {selectedCourseId && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Assignment</label>
              <select
                value={selectedAssignmentId ?? ""}
                onChange={(e) => {
                  const assignment = assignments.find(
                    (a: CanvasAssignment) => String(a.id) === e.target.value
                  );
                  setSelectedAssignmentId(e.target.value || null);
                  setSelectedAssignmentName(assignment?.name ?? null);
                }}
                disabled={assignmentsLoading}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              >
                <option value="">
                  {assignmentsLoading ? "Loading assignments…" : "Select an assignment"}
                </option>
                {assignments.map((a: CanvasAssignment) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                    {a.points_possible ? ` (${a.points_possible} pts)` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Quest completions will be submitted to this assignment
              </p>
            </div>
          )}

          {/* Last sync */}
          {status.lastSyncedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              Last synced {new Date(status.lastSyncedAt).toLocaleString()}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSaveConfig}
              disabled={isSyncing || !selectedCourseId || !selectedAssignmentId}
              className={cn(
                "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                configDirty
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-input hover:bg-accent"
              )}
            >
              {isSyncing ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </span>
              ) : configDirty ? (
                "Save configuration"
              ) : (
                "Configuration saved"
              )}
            </button>
            <button
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              <Link2Off className="h-3.5 w-3.5" />
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
