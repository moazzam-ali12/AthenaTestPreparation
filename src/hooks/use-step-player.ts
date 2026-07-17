"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { WhiteboardStep, CheckInAction, PredictAction, FillBlankAction } from "@/types/whiteboard";

export type StepPlayerState = "idle" | "animating" | "waiting" | "awaiting_input" | "check_in" | "complete";

/** True for step types that pause the player and require student interaction. */
function isInteractionStep(step: WhiteboardStep): boolean {
  const t = step.action.type;
  return t === "check_in" || t === "predict" || t === "fill_blank";
}

/**
 * User-driven step player for sectioned progressive-reveal lessons.
 *
 * Whiteboard steps animate their clip-path reveal over `durationMs`.
 * Interaction steps (check_in, predict, fill_blank) pause and show a question.
 * Check-in steps also act as section boundaries — the board clears when
 * moving past a check-in into the next section.
 */
export function useStepPlayer(
  steps: WhiteboardStep[],
  isStreaming: boolean,
) {
  const [state, setState] = useState<StepPlayerState>("idle");
  const [userStepIndex, setUserStepIndex] = useState(-1);
  const [stepProgress, setStepProgress] = useState(0);
  const [visibleStepIds, setVisibleStepIds] = useState<Set<number>>(new Set());

  const rafRef = useRef(0);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Incremented on every startStep call so a stale tick() loop can detect
  // it's been superseded and stop, even if cancelAnimationFrame races with
  // an already-queued frame — belt-and-suspenders against overlapping loops.
  const tickGenerationRef = useRef(0);

  // True when user called advance() but the next step hasn't streamed in yet
  const pendingAdvanceRef = useRef(false);

  // Index of the whiteboard step currently mid-animation, or -1 when none.
  // Guards against a redundant startStep(sameIndex) call (e.g. from an
  // upstream effect re-firing) restarting the clip-path reveal from 0 and
  // racing a fresh rAF loop against the one already in flight.
  const animatingIndexRef = useRef(-1);

  const isCheckInStep = useCallback((index: number) => {
    const step = stepsRef.current[index];
    return step?.action.type === "check_in";
  }, []);

  // Build visible set. Check-in steps defer clearing so the preceding
  // section's visuals remain visible during the question. The clear fires
  // on the first teaching step of the next section.
  // When `showAll` is true (hydration), skip clearing entirely.
  const buildVisibleIds = useCallback((upTo: number, showAll = false) => {
    const ids = new Set<number>();
    const allSteps = stepsRef.current;
    let pendingClear = false;
    for (let i = 0; i <= upTo && i < allSteps.length; i++) {
      const action = allSteps[i].action;
      if (action.type === "check_in") {
        if (!showAll) pendingClear = true;
        continue;
      }
      // predict/fill_blank don't render on canvas — skip them in visible set
      if (action.type === "predict" || action.type === "fill_blank") {
        continue;
      }
      if (pendingClear) {
        ids.clear();
        pendingClear = false;
      }
      if (action.type === "clear") {
        if (!showAll) ids.clear();
      } else if (action.type === "erase" && action.targetStepIndices) {
        if (!showAll) {
          for (const idx of action.targetStepIndices) {
            const target = allSteps[idx];
            if (target) ids.delete(target.id);
          }
        }
      }
      ids.add(allSteps[i].id);
    }
    return ids;
  }, []);

  // Start a step — animate if whiteboard, pause if interaction
  const startStep = useCallback(
    (index: number) => {
      // No-op if this exact step is already animating — prevents a
      // redundant call from resetting progress and spawning a second tick loop.
      if (index === animatingIndexRef.current) return;

      cancelAnimationFrame(rafRef.current);
      animatingIndexRef.current = -1;
      const generation = ++tickGenerationRef.current;
      const step = stepsRef.current[index];
      if (!step) return;

      pendingAdvanceRef.current = false;

      // Check-in step: section-boundary interaction
      if (step.action.type === "check_in") {
        setState("check_in");
        setVisibleStepIds(buildVisibleIds(index));
        setStepProgress(1);
        return;
      }

      // Predict / fill_blank: pause for student input
      if (step.action.type === "predict" || step.action.type === "fill_blank") {
        setState("awaiting_input");
        setVisibleStepIds(buildVisibleIds(index));
        setStepProgress(1);
        return;
      }

      // Whiteboard step: animate clip-path reveal
      animatingIndexRef.current = index;
      setState("animating");
      setStepProgress(0);
      setVisibleStepIds(buildVisibleIds(index));

      const startTime = performance.now();
      const duration = step.durationMs || 800;

      const tick = () => {
        if (generation !== tickGenerationRef.current) return;

        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setStepProgress(progress);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          animatingIndexRef.current = -1;
          setState("waiting");
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [buildVisibleIds],
  );

  // Auto-start first step when it arrives
  useEffect(() => {
    if (steps.length > 0 && userStepIndex === -1) {
      setUserStepIndex(0);
      startStep(0);
    }
  }, [steps.length, userStepIndex, startStep]);

  // When streaming finishes and we're on the last step, mark complete
  useEffect(() => {
    if (
      !isStreaming &&
      userStepIndex >= 0 &&
      userStepIndex >= steps.length - 1 &&
      state === "waiting"
    ) {
      setState("complete");
    }
  }, [state, userStepIndex, steps.length, isStreaming]);

  // Advance to the next step (called by Continue button or after answering an interaction)
  const advance = useCallback(() => {
    const nextIndex = userStepIndex + 1;
    if (nextIndex < stepsRef.current.length) {
      setUserStepIndex(nextIndex);
      startStep(nextIndex);
    } else if (isStreaming) {
      // Next step hasn't arrived yet — flag it and wait
      pendingAdvanceRef.current = true;
      setState("waiting");
      setUserStepIndex(nextIndex);
    } else {
      // No more steps — lesson is done
      setState("complete");
    }
  }, [userStepIndex, isStreaming, startStep]);

  // When a new step streams in and the user already requested advance, auto-start it
  useEffect(() => {
    if (
      pendingAdvanceRef.current &&
      userStepIndex >= 0 &&
      userStepIndex < steps.length &&
      stepsRef.current[userStepIndex]
    ) {
      startStep(userStepIndex);
    }
  }, [userStepIndex, steps.length, startStep]);

  // Jump to end — show only the last section's steps (for cached lesson hydration)
  const jumpToEnd = useCallback(() => {
    if (steps.length === 0) return;
    const lastIndex = steps.length - 1;
    setUserStepIndex(lastIndex);
    setStepProgress(1);
    setVisibleStepIds(buildVisibleIds(lastIndex, true));
    setState("complete");
    cancelAnimationFrame(rafRef.current);
    animatingIndexRef.current = -1;
  }, [steps.length, buildVisibleIds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Find the "real" current whiteboard step index for the canvas
  // (skip interaction steps backwards to find the last visual step)
  let canvasStepIndex = userStepIndex;
  while (canvasStepIndex >= 0 && stepsRef.current[canvasStepIndex] && isInteractionStep(stepsRef.current[canvasStepIndex])) {
    canvasStepIndex--;
  }

  const canAdvance =
    state === "waiting" &&
    (userStepIndex < steps.length - 1 || isStreaming);

  const isLastStep =
    state === "complete" ||
    (state === "waiting" && !isStreaming && userStepIndex >= steps.length - 1);

  const currentStep = steps[userStepIndex];

  const currentCheckIn =
    state === "check_in" && currentStep?.action.type === "check_in"
      ? (currentStep.action as CheckInAction)
      : null;

  const currentPrediction =
    state === "awaiting_input" && currentStep?.action.type === "predict"
      ? (currentStep.action as PredictAction)
      : null;

  const currentFillBlank =
    state === "awaiting_input" && currentStep?.action.type === "fill_blank"
      ? (currentStep.action as FillBlankAction)
      : null;

  const isInteraction = state === "check_in" || state === "awaiting_input";

  return {
    state,
    userStepIndex,
    currentStepIndex: Math.max(canvasStepIndex, 0),
    stepProgress,
    visibleStepIds,
    canAdvance,
    isLastStep,
    isCheckIn: state === "check_in",
    currentCheckIn,
    isInteraction,
    currentPrediction,
    currentFillBlank,
    advance,
    jumpToEnd,
  };
}
