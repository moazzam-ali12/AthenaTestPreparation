"use client";

import { useState, useCallback, useRef } from "react";
import type { WhiteboardStep } from "@/types/whiteboard";

type WhyPhase = "idle" | "loading" | "streaming" | "ready" | "error";

type WhyMetadata = {
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

export function useWhyThisMatters({
  topic,
  subtopic,
  metadata,
  loreApiPath,
}: {
  topic: string;
  subtopic: string;
  metadata: WhyMetadata;
  loreApiPath?: string;
}) {
  const [phase, setPhase] = useState<WhyPhase>("idle");
  const [whiteboardSteps, setWhiteboardSteps] = useState<WhiteboardStep[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const nextStepIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const collectedStepsRef = useRef<WhiteboardStep[]>([]);

  const saveLore = useCallback(
    async (steps: WhiteboardStep[]) => {
      if (!loreApiPath || steps.length === 0) return;
      try {
        await fetch(loreApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", whiteboardSteps: steps }),
        });
      } catch {
        // Fire-and-forget — save failure is non-fatal
      }
    },
    [loreApiPath]
  );

  const generate = useCallback(async () => {
    if (phase === "loading" || phase === "streaming") return;

    setPhase("loading");
    setWhiteboardSteps([]);
    setIsStreaming(false);
    nextStepIdRef.current = 0;
    collectedStepsRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Check for existing persisted lore
      if (loreApiPath) {
        const cached = await fetch(loreApiPath, { signal: controller.signal });
        if (cached.ok) {
          const data = await cached.json();
          if (
            data &&
            data.status === "ready" &&
            Array.isArray(data.whiteboardSteps) &&
            data.whiteboardSteps.length > 0
          ) {
            const steps = data.whiteboardSteps.map(
              (s: WhiteboardStep, i: number) => ({ ...s, id: i })
            );
            setWhiteboardSteps(steps);
            setPhase("ready");
            return;
          }
        }

        // Acquire generation lock
        const lockRes = await fetch(loreApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
          signal: controller.signal,
        });
        if (lockRes.ok) {
          const lockData = await lockRes.json();
          if (!lockData.acquired) {
            // Another client is generating — poll until ready
            setPhase("loading");
            return;
          }
        }
      }

      // Stream from agent
      const res = await fetch("/api/agent/why-this-matters/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          subtopic,
          ...metadata,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setPhase("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedSteps = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            setIsStreaming(false);
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.wb_step) {
              if (!receivedSteps) {
                receivedSteps = true;
                setIsStreaming(true);
                setPhase("streaming");
              }
              const step = {
                ...parsed.wb_step,
                id: nextStepIdRef.current++,
              } as WhiteboardStep;
              collectedStepsRef.current = [
                ...collectedStepsRef.current,
                step,
              ];
              setWhiteboardSteps((prev) => [...prev, step]);
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      setIsStreaming(false);
      setPhase("ready");

      // Persist generated lore
      saveLore(collectedStepsRef.current);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.error("[why-this-matters] Stream error:", e);
      setPhase("error");
    }
  }, [phase, topic, subtopic, metadata, loreApiPath, saveLore]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setWhiteboardSteps([]);
    setIsStreaming(false);
    nextStepIdRef.current = 0;
    collectedStepsRef.current = [];
  }, []);

  return {
    phase,
    whiteboardSteps,
    isStreaming,
    generate,
    reset,
  };
}
