"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const RESET_REASONS = [
  "I got too busy",
  "I forgot to study",
  "I wasn't feeling well",
  "Technical issues",
  "I needed a break",
  "Other",
];

type Props = {
  missedQuestId: string;
  missedDate: string;
  onComplete: () => void;
};

export function ResetFlowModal({ missedQuestId, missedDate, onComplete }: Props) {
  const [step, setStep] = useState<"reason" | "recommit" | "done">("reason");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const formatted = new Date(missedDate + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const { mutate: submitReset, isPending } = useMutation({
    mutationFn: () =>
      fetch("/api/daily-quest/accountability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questId: missedQuestId, reason: selectedReason }),
      }).then((r) => {
        if (!r.ok) throw new Error("Reset failed");
        return r.json();
      }),
    onSuccess: () => {
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["accountability"] });
      queryClient.invalidateQueries({ queryKey: ["daily-quest"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("Something went wrong. Please try again."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <AnimatePresence mode="wait">
          {step === "reason" && (
            <motion.div
              key="reason"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <h2 className="font-bold text-lg">Missed Session</h2>
                  <p className="text-sm text-muted-foreground">{formatted}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                You missed your study session. Before you can continue, tell us what happened so we can help you stay on track.
              </p>
              <div className="space-y-2 mb-6">
                {RESET_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedReason(r)}
                    className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                      selectedReason === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Button
                className="w-full"
                disabled={!selectedReason}
                onClick={() => setStep("recommit")}
              >
                Continue
              </Button>
            </motion.div>
          )}

          {step === "recommit" && (
            <motion.div
              key="recommit"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h2 className="font-bold text-lg mb-2">Recommit to Your Goal</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Missing a session happens. What matters is getting back on track. Your daily quest will be available again once you recommit.
              </p>
              <div className="rounded-xl border bg-muted/30 p-4 mb-6">
                <p className="text-sm font-medium mb-1">Your reason</p>
                <p className="text-sm text-muted-foreground">{selectedReason}</p>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-6">
                <p className="text-sm">
                  💪 <strong>I commit</strong> to completing my daily CPA study quests consistently. Missing one session is not the end — showing up tomorrow is what matters.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setStep("reason")}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={isPending}
                  onClick={() => submitReset()}
                >
                  {isPending ? "Saving..." : "I Recommit"}
                </Button>
              </div>
            </motion.div>
          )}

          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-4"
            >
              <div className="flex justify-center mb-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle className="h-8 w-8 text-green-400" />
                </div>
              </div>
              <h2 className="font-bold text-xl mb-2">You&apos;re back!</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Great attitude. Your daily quest is ready. Let&apos;s get back to work.
              </p>
              <Button className="w-full" onClick={onComplete}>
                Start Today&apos;s Quest
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
