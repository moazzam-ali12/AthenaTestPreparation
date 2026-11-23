"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAthenaConversation } from "@/hooks/use-athena-conversation";
import type { QuizContext } from "@/hooks/use-athena-conversation";
import { useWhiteboardPlayer } from "@/hooks/use-whiteboard-player";
import { TutorModeOverlay } from "@/components/quiz/tutor-mode-overlay";
import { TutorModeControls } from "@/components/quiz/tutor-mode-controls";
import { resolveTutorMode, type TutorMode } from "@/lib/tutor-modes";
import type { Problem } from "@/components/quiz/types";
import type { FeedbackState } from "@/components/quiz/answer-panel";
import type { SelectedElement } from "@/types/whiteboard";

type QuizTutorFabProps = {
  topicName: string;
  subtopicName: string;
  currentProblem: Problem;
  questionNumber: number;
  studentAnswer?: number;
  feedbackState?: FeedbackState;
  onSelectAnswer?: (optionIndex: number) => void;
  onOpenChange?: (open: boolean) => void;
  autoOpen?: boolean;
  autoMessage?: string;
  quizStreamUrl?: string;
  /** Start with overlay already open (no FAB shown initially) */
  defaultOpen?: boolean;
  /** Called instead of toggling closed state — use for route-based close */
  onClose?: () => void;
  /** Optional slot rendered in place of the floating question card */
  practiceContent?: React.ReactNode;
  /** When in practice phase, override the quiz context so the AI knows about the practice problem */
  practiceContextOverride?: QuizContext;
  /** Sends `text` to the tutor once per new `id` (e.g. an "Ask the AI tutor" button). */
  askRequest?: { id: number; text: string };
};

export function QuizTutorFab({ topicName, subtopicName, currentProblem, questionNumber, studentAnswer, feedbackState, onSelectAnswer, onOpenChange, autoOpen, autoMessage, quizStreamUrl, defaultOpen = false, onClose, practiceContent, practiceContextOverride, askRequest }: QuizTutorFabProps) {
  const [open, setOpenState] = useState(defaultOpen);
  const hasAutoTriggered = useRef(false);
  const practiceResetRef = useRef(false);

  const setOpen = useCallback((value: boolean) => {
    setOpenState(value);
    onOpenChange?.(value);
    if (!value) onClose?.();
  }, [onOpenChange, onClose]);
  const [input, setInput] = useState("");
  const [selections, setSelections] = useState<SelectedElement[]>([]);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tutor modes (Hint / Guided / Full explanation) — only the main quiz tutor route
  // supports them; a custom stream URL (My Learning) keeps its single behaviour.
  const modesEnabled = !quizStreamUrl;
  const queryClient = useQueryClient();
  const { data: tutorPrefs } = useQuery({
    queryKey: ["tutor-preferences"],
    queryFn: () =>
      fetch("/api/tutor-preferences").then((r) => {
        if (!r.ok) throw new Error("Failed to load tutor preferences");
        return r.json() as Promise<{ tutorMode: TutorMode | null }>;
      }),
    staleTime: 5 * 60_000,
    enabled: modesEnabled,
  });
  const { mutate: saveTutorMode } = useMutation({
    mutationFn: (tutorMode: TutorMode) =>
      fetch("/api/tutor-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tutorMode }),
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to save tutor mode");
      }),
    onMutate: (tutorMode) =>
      queryClient.setQueryData(["tutor-preferences"], (prev: object | undefined) => ({ ...prev, tutorMode })),
  });
  const answered = typeof studentAnswer === "number";
  const tutorMode = resolveTutorMode(tutorPrefs?.tutorMode, answered && !practiceContextOverride);
  const answeredWrong =
    answered && !practiceContextOverride && currentProblem.correctOption >= 0 && studentAnswer !== currentProblem.correctOption;

  const {
    messages,
    mode,
    isRecording,
    isProcessing,
    isSpeaking,
    amplitude,
    whiteboardSteps,
    isWhiteboardStreaming,
    sendMessage,
    startRecording,
    stopRecording,
    toggleMode,
    reset,
    practiceLinks,
  } = useAthenaConversation({
    lessonTitle: subtopicName,
    lessonContent: "",
    variant: "quiz",
    quizStreamUrl,
    tutorMode: modesEnabled ? tutorMode : undefined,
    quizContext: practiceContextOverride ?? {
      topic: topicName,
      subtopic: subtopicName,
      questionText: currentProblem.questionText,
      options: currentProblem.options,
      hint: currentProblem.hint,
      solutionSteps: currentProblem.solutionSteps,
      // Not answered yet → the key isn't in the browser; the route resolves it
      // (and prefers its own key whenever it has one for this problem id).
      ...(currentProblem.correctOption >= 0 ? { correctOption: currentProblem.correctOption } : {}),
      problemId: currentProblem.id,
      studentAnswer,
    },
  });

  const {
    currentStepIndex,
    stepProgress,
    visibleStepIds,
    state: playerState,
    speed,
    play,
    pause,
    replay,
    seekToStep,
    changeSpeed,
  } = useWhiteboardPlayer(whiteboardSteps, isWhiteboardStreaming);

  // Auto-open tutor on wrong answer
  useEffect(() => {
    if (autoOpen && autoMessage && !hasAutoTriggered.current) {
      hasAutoTriggered.current = true;
      setOpen(true);
      sendMessage(autoMessage);
    }
  }, [autoOpen, autoMessage, setOpen, sendMessage]);

  // External "ask" trigger — goes through the normal tutor stream (and its trial cap).
  const lastAskIdRef = useRef(0);
  useEffect(() => {
    if (!askRequest || askRequest.id === lastAskIdRef.current) return;
    lastAskIdRef.current = askRequest.id;
    setOpen(true);
    sendMessage(askRequest.text);
  }, [askRequest, setOpen, sendMessage]);

  // Clear conversation + whiteboard when entering practice phase
  useEffect(() => {
    if (practiceContent && !practiceResetRef.current) {
      practiceResetRef.current = true;
      reset(null);
    } else if (!practiceContent) {
      practiceResetRef.current = false;
    }
  }, [practiceContent, reset]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, setOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    sendMessage(input.trim());
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const buildQuestion = useCallback((sels: SelectedElement[]): string => {
    if (sels.length === 0) return "";
    if (sels.length === 1) {
      const el = sels[0];
      return el.type === "write_math"
        ? el.isTerm ? `Can you explain "${el.content}" in this expression?` : `Can you explain this step: $${el.content}$?`
        : el.isTerm ? `What does "${el.content}" mean here?` : `Can you explain this further: "${el.content}"?`;
    }
    const parts = sels.map(el =>
      el.type === "write_math" ? (el.isTerm ? `"${el.content}"` : `$${el.content}$`) : `"${el.content}"`
    );
    return `Can you explain ${parts.join(" and ")}?`;
  }, []);

  const handleElementSelect = useCallback((el: SelectedElement | null) => {
    if (!el) { setSelections([]); return; }
    const next = [el];
    setSelections(next);
    setInput(buildQuestion(next));
    if (mode === "voice") toggleMode();
    setFocusTrigger((n) => n + 1);
  }, [mode, toggleMode, buildQuestion]);

  const handleElementToggle = useCallback((el: SelectedElement) => {
    setSelections(prev => {
      const key = `${el.stepId}:${el.content}`;
      const exists = prev.some(s => `${s.stepId}:${s.content}` === key);
      const next = exists ? prev.filter(s => `${s.stepId}:${s.content}` !== key) : [...prev, el];
      setInput(buildQuestion(next));
      if (next.length > 0) setFocusTrigger(n => n + 1);
      return next;
    });
  }, [buildQuestion]);

  const handleElementsSelect = useCallback((els: SelectedElement[]) => {
    setSelections(els);
    setInput(buildQuestion(els));
    if (mode === "voice") toggleMode();
    setFocusTrigger(n => n + 1);
  }, [buildQuestion, mode, toggleMode]);

  useEffect(() => {
    if (isWhiteboardStreaming) setSelections([]);
  }, [isWhiteboardStreaming]);

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-4 left-4 z-40 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
            style={{ width: 60, height: 60 }}
          >
            {/* Breathing pulse */}
            <motion.span
              className="absolute inset-0 rounded-full bg-primary"
              animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />
            <Sparkles className="relative h-6 w-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Full-screen Tutor Mode Overlay */}
      <AnimatePresence>
        {open && (
          <TutorModeOverlay
            problem={currentProblem}
            questionNumber={questionNumber}
            selectedOption={studentAnswer}
            feedbackState={feedbackState}
            onSelectAnswer={(i) => onSelectAnswer?.(i)}
            messages={messages}
            isProcessing={isProcessing}
            isSpeaking={isSpeaking}
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            onKeyDown={handleKeyDown}
            mode={mode}
            onToggleMode={toggleMode}
            isRecording={isRecording}
            amplitude={amplitude}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            whiteboardSteps={whiteboardSteps}
            isWhiteboardStreaming={isWhiteboardStreaming}
            currentStepIndex={currentStepIndex}
            stepProgress={stepProgress}
            visibleStepIds={visibleStepIds}
            playerState={playerState}
            speed={speed}
            onPlay={play}
            onPause={pause}
            onReplay={replay}
            onSeekToStep={seekToStep}
            onChangeSpeed={changeSpeed}
            selections={selections}
            onElementSelect={handleElementSelect}
            onElementToggle={handleElementToggle}
            onElementsSelect={handleElementsSelect}
            focusTrigger={focusTrigger}
            practiceContent={practiceContent}
            tutorControls={
              modesEnabled ? (
                <TutorModeControls
                  mode={tutorMode}
                  onModeChange={(m) => saveTutorMode(m)}
                  onWhyWrong={
                    answeredWrong
                      ? () => sendMessage("Why was my answer wrong?", { mode: "why_wrong" })
                      : undefined
                  }
                  practiceLinks={practiceLinks}
                  disabled={isProcessing}
                />
              ) : undefined
            }
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
