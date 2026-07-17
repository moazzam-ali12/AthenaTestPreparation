"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { WhiteboardCanvas } from "@/components/whiteboard/whiteboard-canvas";
import { WhiteboardSkeleton } from "@/components/whiteboard/whiteboard-skeleton";
import { useWhiteboardPlayer } from "@/hooks/use-whiteboard-player";
import { useWhyThisMatters } from "@/hooks/use-why-this-matters";

type WhyThisMattersModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: string;
  subtopic: string;
  metadata: {
    description?: string;
    learningObjectives?: string[];
    keyFormulas?: { latex: string; description: string }[];
    commonMistakes?: { mistake: string; correction: string; why: string }[];
    tipsAndTricks?: string[];
    conceptualOverview?: {
      definition: string;
      realWorldExample: string;
      actContext: string;
    };
  };
  loreApiPath?: string;
};

export function WhyThisMattersModal({
  open,
  onOpenChange,
  topic,
  subtopic,
  metadata,
  loreApiPath,
}: WhyThisMattersModalProps) {
  const { phase, whiteboardSteps, isStreaming, generate, reset } =
    useWhyThisMatters({ topic, subtopic, metadata, loreApiPath });

  const player = useWhiteboardPlayer(whiteboardSteps, isStreaming);

  useEffect(() => {
    if (open && phase === "idle") {
      generate();
    }
  }, [open, phase, generate]);

  const showCanvas = phase === "streaming" || phase === "ready";
  const showSkeleton = phase === "idle" || phase === "loading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[70vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">
              Why do I need to know this?
            </DialogTitle>
            {phase === "ready" && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={player.replay}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Replay
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {showSkeleton && <WhiteboardSkeleton className="h-full" />}
          {showCanvas && (
            <WhiteboardCanvas
              steps={whiteboardSteps}
              visibleStepIds={player.visibleStepIds}
              currentStepIndex={player.currentStepIndex}
              stepProgress={player.stepProgress}
            />
          )}
          {phase === "error" && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-muted-foreground">
                Failed to generate. Please try again.
              </p>
              <Button variant="outline" size="sm" onClick={generate}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
