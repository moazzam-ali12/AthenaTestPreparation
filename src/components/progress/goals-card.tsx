"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type GoalType = "weekly_xp" | "accuracy_target" | "streak_days";

type Goal = {
  goalType: GoalType;
  targetValue: number;
  currentValue: number;
};

const GOAL_META: Record<GoalType, { label: string; unit: string; defaultTarget: number }> = {
  weekly_xp: { label: "Weekly XP Target", unit: "XP", defaultTarget: 200 },
  accuracy_target: { label: "Accuracy Target", unit: "%", defaultTarget: 80 },
  streak_days: { label: "Streak Target", unit: "days", defaultTarget: 7 },
};

const GOAL_ORDER: GoalType[] = ["weekly_xp", "accuracy_target", "streak_days"];

function GoalRow({
  goalType,
  goal,
  onSave,
  saving,
}: {
  goalType: GoalType;
  goal: Goal | undefined;
  onSave: (goalType: GoalType, targetValue: number) => void;
  saving: boolean;
}) {
  const meta = GOAL_META[goalType];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const target = goal?.targetValue ?? null;
  const current = goal?.currentValue ?? 0;
  const pct = target ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {meta.label}
        </p>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-16 rounded border bg-background px-1.5 py-0.5 text-xs"
              autoFocus
            />
            <button
              className="text-xs font-medium text-primary hover:underline"
              disabled={saving}
              onClick={() => {
                const value = Number(draft);
                if (value > 0) {
                  onSave(goalType, value);
                  setEditing(false);
                }
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDraft(String(target ?? meta.defaultTarget));
              setEditing(true);
            }}
          >
            {target ? `${current}/${target} ${meta.unit}` : "Set a target"}
          </button>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-athena-success" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function GoalsCard() {
  const queryClient = useQueryClient();

  const { data, isError } = useQuery<{ goals: Goal[] }>({
    queryKey: ["goals"],
    queryFn: () =>
      fetch("/api/goals").then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (isError) toast.error("Failed to load goals");
  }, [isError]);

  const { mutate: saveGoal, isPending } = useMutation({
    mutationFn: async ({ goalType, targetValue }: { goalType: GoalType; targetValue: number }) => {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalType, targetValue }),
      });
      if (!res.ok) throw new Error("Failed to save goal");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["goals"], result);
      toast.success("Goal updated");
    },
    onError: () => toast.error("Failed to save goal"),
  });

  const goalsByType = new Map((data?.goals ?? []).map((g) => [g.goalType, g]));

  return (
    <div className="border bg-card p-5 space-y-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Your Goals
      </h2>
      <div className="space-y-4">
        {GOAL_ORDER.map((goalType) => (
          <GoalRow
            key={goalType}
            goalType={goalType}
            goal={goalsByType.get(goalType)}
            onSave={(t, v) => saveGoal({ goalType: t, targetValue: v })}
            saving={isPending}
          />
        ))}
      </div>
    </div>
  );
}
