"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import type { WhiteboardStep, CheckInAction, PredictAction, FillBlankAction } from "@/types/whiteboard";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Sparkles, ChevronLeft, BookOpen, ChevronRight, Check, X,
  Send, Mic, Keyboard, CheckCircle,
} from "lucide-react";
import { useMicroLesson } from "@/hooks/use-micro-lesson";
import { useLessonChat } from "@/hooks/use-lesson-chat";
import { WhiteboardCanvas, type StepFocus } from "@/components/whiteboard/whiteboard-canvas";
import { LessonTeachingPointer } from "@/components/learning/lesson-teaching-pointer";
import { WbCoordinatePlane } from "@/components/whiteboard/elements/wb-coordinate-plane";
import { WbGeometry } from "@/components/whiteboard/elements/wb-geometry";
import type { CoordinatePlaneAction, GeometryAction } from "@/types/whiteboard";
import { useStepPlayer } from "@/hooks/use-step-player";
import { MessageBubble } from "@/components/lessons/message-bubble";
import { ThinkingIndicator } from "@/components/lessons/thinking-indicator";
import { VoiceOrb } from "@/components/lessons/voice-orb";
import PixelCharacter from "@/components/shared/PixelCharacter";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSound } from "@/hooks/useSound";
import { MathContent } from "@/components/quiz/math-content";
import { PracticeGradientCard } from "@/components/quiz/practice-gradient-card";
import type { Problem } from "@/components/quiz/types";
import { WhiteboardSkeleton } from "@/components/whiteboard/whiteboard-skeleton";
import { GenerationProgress } from "@/components/lessons/generation-progress";
import { WhyThisMattersModal } from "@/components/learning/why-this-matters-modal";

type MicroLessonProps = {
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
  onClose: () => void;
  practiceProblems?: Problem[];
  streamUrl?: string;
  chatStreamUrl?: string;
  existingLesson?: { lessonContent: string; whiteboardSteps: WhiteboardStep[] } | null;
  subtopicApiPath?: string;
  practiceMode?: {
    subject?: "math" | "english" | "reading" | "science" | "aud" | "far" | "reg" | "bar" | "isc" | "tcp";
    quizStreamUrl?: string;
  };
  tracking?: {
    microLessonId: string;
    subtopicId: string;
  };
};

// ── Check-in question UI ──────────────────────────────────────────────

function CheckInConfetti() {
  const colors = [
    "hsl(var(--green))",
    "hsl(var(--blue))",
    "hsl(var(--yellow))",
    "hsl(var(--pink))",
    "hsl(var(--orange))",
  ];
  const particles = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.4,
    size: 3 + Math.random() * 3,
    color: colors[i % colors.length],
  }));
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            bottom: "30%",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
          }}
          initial={{ y: 0, opacity: 1 }}
          animate={{
            y: -180 - Math.random() * 120,
            opacity: [1, 1, 0],
            x: (Math.random() - 0.5) * 80,
          }}
          transition={{
            duration: 1.2 + Math.random() * 0.4,
            delay: p.delay,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

function CheckInCard({
  checkIn,
  onAnswer,
  onNarrate,
  onHintPhase,
}: {
  checkIn: CheckInAction;
  onAnswer: () => void;
  onNarrate?: (text: string) => void;
  onHintPhase?: (phase: "none" | "hinted" | "detailed") => void;
}) {
  const [phase, setPhase] = useState<"answering" | "hinted" | "detailed" | "revealed">("answering");
  const [selected, setSelected] = useState<number | null>(null);
  const [wrongIndices, setWrongIndices] = useState<Set<number>>(new Set());
  const sound = useSound();

  const isCorrect = selected === checkIn.correctOption;
  const isRevealed = phase === "revealed";

  const handleSelect = (index: number) => {
    if (isRevealed) return;
    if (wrongIndices.has(index)) return; // can't re-pick a wrong answer

    setSelected(index);

    if (index === checkIn.correctOption) {
      sound.achievement();
      setPhase("revealed");
      onNarrate?.("Correct! Let's move on.");
      return;
    }

    // Wrong answer — progressive gradient
    sound.wrong();
    const next = new Set(wrongIndices);
    next.add(index);
    setWrongIndices(next);

    if (phase === "answering" && checkIn.hint) {
      // 1st wrong + hint available: nudge hint, allow retry
      setPhase("hinted");
      onHintPhase?.("hinted");
      onNarrate?.(checkIn.hint);
    } else if (phase === "hinted" && checkIn.detailedHint) {
      // 2nd wrong + detailed hint available: walk-through hint, allow retry
      setPhase("detailed");
      onHintPhase?.("detailed");
      onNarrate?.(checkIn.detailedHint);
    } else {
      // No more hints available: reveal answer
      setPhase("revealed");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-2 relative"
    >
      {isRevealed && isCorrect && <CheckInConfetti />}
      <p className="text-sm font-medium text-foreground">{checkIn.question}</p>

      <div className="grid gap-1.5">
        {checkIn.options.map((option, i) => {
          const isThis = selected === i;
          const isRight = i === checkIn.correctOption;
          const isWrong = wrongIndices.has(i);
          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={isRevealed || isWrong}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors",
                !isRevealed && !isWrong && "hover:bg-muted cursor-pointer",
                isRevealed && isRight && "border-green-500 bg-green-500/10",
                isRevealed && isThis && !isRight && "border-red-500 bg-red-500/10",
                isRevealed && !isThis && !isRight && "opacity-50",
                isWrong && !isRevealed && "border-red-500/50 bg-red-500/5 opacity-60",
              )}
              style={
                isRevealed && isRight
                  ? { boxShadow: "0 0 12px rgba(34, 197, 94, 0.3)" }
                  : undefined
              }
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                {isRevealed && isRight ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (isRevealed && isThis && !isRight) || isWrong ? (
                  <X className="h-3 w-3 text-red-500" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              {option}
            </button>
          );
        })}
      </div>

      {(phase === "hinted" || phase === "detailed") && checkIn.hint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-athena-amber/40 bg-athena-amber/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-athena-amber mb-0.5">
            Not quite! Here&apos;s a hint:
          </p>
          <p className="text-sm text-muted-foreground">{checkIn.hint}</p>
        </motion.div>
      )}

      {phase === "detailed" && checkIn.detailedHint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-0.5">
            Let me walk you through it:
          </p>
          <p className="text-sm text-muted-foreground">{checkIn.detailedHint}</p>
        </motion.div>
      )}

      {isRevealed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-1.5"
        >
          {isCorrect && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex items-center gap-1.5 text-green-500"
            >
              <Check className="h-4 w-4" />
              <span className="text-sm font-bold">Correct!</span>
            </motion.div>
          )}
          <p className="text-xs text-muted-foreground">{checkIn.explanation}</p>
          <Button size="xs" className="gap-1" onClick={onAnswer}>
            {isCorrect ? "Continue" : "Got it, continue"}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Predict question UI ──────────────────────────────────────────────

function PredictCard({
  predict,
  onAnswer,
  onNarrate,
  onHintPhase,
}: {
  predict: PredictAction;
  onAnswer: () => void;
  onNarrate?: (text: string) => void;
  onHintPhase?: (phase: "none" | "hinted" | "detailed") => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [wrongIndices, setWrongIndices] = useState<Set<number>>(new Set());
  const [showHint, setShowHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const answeredRef = useRef(false);
  const sound = useSound();

  const isCorrect = selected === predict.correctOption;

  const handleSelect = (index: number) => {
    if (revealed || wrongIndices.has(index)) return;
    setSelected(index);

    if (index === predict.correctOption) {
      sound.achievement();
      setRevealed(true);
      onNarrate?.("Correct! Let's move on.");
      return;
    }

    // Wrong — disable this option, show hint, let student retry remaining
    sound.wrong();
    const next = new Set(wrongIndices);
    next.add(index);
    setWrongIndices(next);

    // Show hint after first wrong if available
    if (predict.hint && !showHint) {
      setShowHint(true);
      onHintPhase?.("hinted");
      onNarrate?.(predict.hint);
    }

    // If all wrong options exhausted, reveal (only correct one remains)
    const wrongCount = next.size;
    if (wrongCount >= predict.options.length - 1) {
      setSelected(predict.correctOption);
      setRevealed(true);
    }
  };

  // Auto-advance after reveal
  useEffect(() => {
    if (revealed && !answeredRef.current) {
      answeredRef.current = true;
      onAnswer();
    }
  }, [revealed, onAnswer]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-2 relative"
    >
      <p className="text-sm font-medium text-foreground">{predict.question}</p>

      <div className="grid gap-1.5">
        {predict.options.map((option, i) => {
          const isThis = selected === i;
          const isRight = i === predict.correctOption;
          const isWrong = wrongIndices.has(i);
          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={revealed || isWrong}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors",
                !revealed && !isWrong && "hover:bg-muted cursor-pointer",
                revealed && isRight && "border-green-500 bg-green-500/10",
                revealed && isThis && !isRight && "border-red-500 bg-red-500/10",
                revealed && !isThis && !isRight && "opacity-50",
                isWrong && !revealed && "border-red-500/50 bg-red-500/5 opacity-60",
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                {revealed && isRight ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (revealed && isThis && !isRight) || isWrong ? (
                  <X className="h-3 w-3 text-red-500" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              {option}
            </button>
          );
        })}
      </div>

      {showHint && !revealed && predict.hint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-athena-amber/40 bg-athena-amber/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-athena-amber mb-0.5">
            Think about it:
          </p>
          <p className="text-sm text-muted-foreground">{predict.hint}</p>
        </motion.div>
      )}

      {revealed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-1.5"
        >
          {isCorrect && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex items-center gap-1.5 text-green-500"
            >
              <Check className="h-4 w-4" />
              <span className="text-sm font-bold">Correct</span>
            </motion.div>
          )}
          <p className="text-xs text-muted-foreground">{predict.explanation}</p>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Fill-blank question UI ──────────────────────────────────────────

function FillBlankCard({
  fillBlank,
  onAnswer,
  onNarrate,
  onHintPhase,
}: {
  fillBlank: FillBlankAction;
  onAnswer: () => void;
  onNarrate?: (text: string) => void;
  onHintPhase?: (phase: "none" | "hinted" | "detailed") => void;
}) {
  const [input, setInput] = useState("");
  const [attempts, setAttempts] = useState(0);
  // answering → hinted (nudge) → detailed (walk-through) → revealed
  const [phase, setPhase] = useState<"answering" | "hinted" | "detailed" | "revealed">("answering");
  const [lastWrong, setLastWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const answeredRef = useRef(false);
  const sound = useSound();

  const isRevealed = phase === "revealed";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clear shake animation after short delay
  useEffect(() => {
    if (lastWrong) {
      const t = setTimeout(() => setLastWrong(false), 500);
      return () => clearTimeout(t);
    }
  }, [lastWrong]);

  // Auto-advance after reveal
  useEffect(() => {
    if (isRevealed && !answeredRef.current) {
      answeredRef.current = true;
      onAnswer();
    }
  }, [isRevealed, onAnswer]);

  const checkAnswer = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const isCorrect = fillBlank.acceptedAnswers.some(
      (a) => a.trim().toLowerCase() === trimmed.toLowerCase()
    );

    if (isCorrect) {
      sound.achievement();
      setPhase("revealed");
      onNarrate?.("Correct! Let's move on.");
      return;
    }

    // Wrong answer
    sound.wrong();
    setLastWrong(true);
    setInput("");
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);

    if (newAttempts === 1 && fillBlank.hint) {
      // 1st wrong: show nudge hint
      setPhase("hinted");
      onHintPhase?.("hinted");
      onNarrate?.(fillBlank.hint);
    } else if (newAttempts === 2 && fillBlank.detailedHint) {
      // 2nd wrong: show detailed walk-through hint
      setPhase("detailed");
      onHintPhase?.("detailed");
      onNarrate?.(fillBlank.detailedHint);
    } else if (newAttempts >= 3 || (newAttempts >= 2 && !fillBlank.detailedHint)) {
      // 3rd wrong (or 2nd if no detailed hint): reveal
      setPhase("revealed");
    }

    // Re-focus input for retry
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const isCorrect = phase === "revealed" && fillBlank.acceptedAnswers.some(
    (a) => a.trim().toLowerCase() === input.trim().toLowerCase()
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-2"
    >
      <div className="text-sm font-medium text-foreground">
        <MathContent content={fillBlank.prompt} />
      </div>

      {!isRevealed && (
        <motion.div
          animate={lastWrong ? { x: [-4, 4, -4, 4, 0] } : {}}
          transition={{ duration: 0.3 }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") checkAnswer(); }}
            placeholder="Type your answer..."
            className="flex-1 bg-muted/50 rounded-lg text-sm outline-none placeholder:text-muted-foreground py-2 px-3 border focus:border-athena-amber/50 transition-colors"
          />
          <Button size="sm" onClick={checkAnswer} disabled={!input.trim()}>
            Check
          </Button>
        </motion.div>
      )}

      {/* Tier 1: nudge hint */}
      {(phase === "hinted" || phase === "detailed") && fillBlank.hint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-athena-amber/40 bg-athena-amber/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-athena-amber mb-0.5">
            Think about it:
          </p>
          <p className="text-sm text-muted-foreground">{fillBlank.hint}</p>
        </motion.div>
      )}

      {/* Tier 2: detailed walk-through hint */}
      {phase === "detailed" && fillBlank.detailedHint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-500 mb-0.5">
            Let me walk you through it:
          </p>
          <p className="text-sm text-muted-foreground">{fillBlank.detailedHint}</p>
        </motion.div>
      )}

      {isRevealed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-1.5"
        >
          {isCorrect ? (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex items-center gap-1.5 text-green-500"
            >
              <Check className="h-4 w-4" />
              <span className="text-sm font-bold">Correct</span>
            </motion.div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Answer: <span className="font-medium text-foreground">{fillBlank.acceptedAnswers[0]}</span>
            </p>
          )}
          <p className="text-xs text-muted-foreground">{fillBlank.explanation}</p>
        </motion.div>
      )}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function MicroLesson({
  topic,
  subtopic,
  metadata,
  onClose,
  practiceProblems: providedPracticeProblems,
  streamUrl,
  chatStreamUrl,
  existingLesson,
  subtopicApiPath,
  practiceMode,
  tracking,
}: MicroLessonProps) {
  const {
    phase,
    lessonContent,
    whiteboardSteps,
    isWhiteboardStreaming,
    generateLesson,
    updateTracking,
  } = useMicroLesson({ topic, subtopic, metadata, streamUrl, chatStreamUrl, existingLesson, subtopicApiPath, tracking });

  const {
    state: playerState,
    userStepIndex,
    currentStepIndex,
    stepProgress,
    visibleStepIds,
    isLastStep,
    isCheckIn,
    currentCheckIn,
    isInteraction,
    currentPrediction,
    currentFillBlank,
    advance,
  } = useStepPlayer(whiteboardSteps, isWhiteboardStreaming);

  // ── "Why?" modal state ──────────────────────────────────────────────
  const [whyModalOpen, setWhyModalOpen] = useState(false);

  // ── Teaching pointer: tracks where the current step renders on-canvas ──
  const [stepFocus, setStepFocus] = useState<StepFocus | null>(null);

  // ── Practice phase state ─────────────────────────────────────────────

  type LessonPhase = "lesson" | "practice" | "complete";
  const [lessonPhase, setLessonPhase] = useState<LessonPhase>("lesson");
  const [fetchedPracticeProblems, setFetchedPracticeProblems] = useState<Problem[]>([]);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [practiceCorrectCount, setPracticeCorrectCount] = useState(0);
  const [isPracticeLoading, setIsPracticeLoading] = useState(false);
  const prefetchedRef = useRef(false);

  const activePracticeProblems = providedPracticeProblems ?? fetchedPracticeProblems;
  const currentPracticeProblem = activePracticeProblems[currentProblemIndex] ?? null;

  // My Learning lessons pass a /api/my-learning/topics/<id>/micro-lesson
  // subtopicApiPath. Derive the sibling practice route from it so in-lesson
  // practice sources from the same stored custom questions as the quiz card
  // (no CPA generator). ACT / other flows keep the default agent endpoint.
  const myLearningPracticeUrl = subtopicApiPath?.startsWith("/api/my-learning/topics/")
    ? subtopicApiPath.replace(/\/micro-lesson$/, "/practice-problems")
    : null;

  const fetchPracticeProblems = useCallback(async () => {
    if (providedPracticeProblems) return;
    setIsPracticeLoading(true);
    try {
      const res = myLearningPracticeUrl
        ? await fetch(myLearningPracticeUrl)
        : await fetch("/api/agent/practice-problems", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic,
              subtopic,
              subject: practiceMode?.subject ?? "math",
            }),
          });
      if (!res.ok) throw new Error("Failed to load practice problems");
      const data = await res.json();
      setFetchedPracticeProblems((data.problems as Problem[]).slice(0, 2));
    } catch {
      toast.error("Could not load practice problems");
      setLessonPhase("complete");
    } finally {
      setIsPracticeLoading(false);
    }
  }, [topic, subtopic, practiceMode?.subject, providedPracticeProblems, myLearningPracticeUrl]);

  // Pre-fetch problems near end of lesson
  useEffect(() => {
    if (
      prefetchedRef.current ||
      providedPracticeProblems ||
      whiteboardSteps.length === 0 ||
      userStepIndex < whiteboardSteps.length - 3
    ) return;
    prefetchedRef.current = true;
    fetchPracticeProblems();
  }, [userStepIndex, whiteboardSteps.length, fetchPracticeProblems, providedPracticeProblems]);

  // ── Chat state ───────────────────────────────────────────────────────

  const [isChatting, setIsChatting] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const chat = useLessonChat({
    topic,
    subtopic,
    lessonContent,
    metadata,
    whiteboardSteps,
    currentStepIndex: userStepIndex,
    chatStreamUrl,
    currentPracticeProblem: lessonPhase === "practice" ? currentPracticeProblem : null,
  });

  // Build visible IDs for chat whiteboard — progressive reveal synced with narration
  const chatVisibleIds = useMemo(() => {
    const ids = new Set<number>();
    const upTo = Math.min(
      Math.max(chat.chatNarrationIndex, 0),
      chat.chatWhiteboardSteps.length - 1,
    );
    for (let i = 0; i <= upTo; i++) {
      const step = chat.chatWhiteboardSteps[i];
      if (step.action.type === "clear") {
        ids.clear();
      } else if (step.action.type === "erase" && step.action.targetStepIndices) {
        for (const idx of step.action.targetStepIndices) {
          const target = chat.chatWhiteboardSteps[idx];
          if (target) ids.delete(target.id);
        }
      }
      ids.add(step.id);
    }
    return ids;
  }, [chat.chatWhiteboardSteps, chat.chatNarrationIndex]);

  // Track which hint tier the student is on (for canvas visual updates)
  const [interactionHintPhase, setInteractionHintPhase] = useState<"none" | "hinted" | "detailed">("none");

  // ── Tracking: push step/checkin counts to session tracking ────────
  const checkinsCorrectRef = useRef(0);
  const checkinsTotalRef = useRef(0);

  useEffect(() => {
    updateTracking({ stepsViewed: Math.max(0, userStepIndex + 1) });
  }, [userStepIndex, updateTracking]);

  // Reset hint phase when advancing to a new step
  const wrappedAdvance = useCallback(() => {
    // If advancing past a check-in, count it
    const step = whiteboardSteps[userStepIndex];
    if (step && step.action.type === "check_in") {
      checkinsTotalRef.current++;
      // Check-in was answered correctly if the player advanced (onAnswer is only called on completion)
      checkinsCorrectRef.current++;
      updateTracking({
        checkinsCorrect: checkinsCorrectRef.current,
        checkinsTotal: checkinsTotalRef.current,
      });
    }
    setInteractionHintPhase("none");
    advance();
  }, [advance, whiteboardSteps, userStepIndex, updateTracking]);

  // Build synthetic step for interaction visual (shown on canvas during check-in/predict/fill_blank)
  // Selects the appropriate visual based on hint phase with fallback chain
  const activeInteractionVisual = useMemo(() => {
    const action = currentCheckIn ?? currentPrediction ?? currentFillBlank ?? null;
    if (!action) return null;

    if (interactionHintPhase === "detailed" && "detailedHintVisual" in action) {
      return action.detailedHintVisual ?? ("hintVisual" in action ? action.hintVisual : null) ?? action.visual ?? null;
    }
    if (interactionHintPhase === "hinted" && "hintVisual" in action) {
      return action.hintVisual ?? action.visual ?? null;
    }
    return action.visual ?? null;
  }, [currentCheckIn, currentPrediction, currentFillBlank, interactionHintPhase]);

  const interactionVisualStep = useMemo(() => {
    if (!isInteraction || !activeInteractionVisual) return null;
    return { id: -1, delayMs: 0, durationMs: 0, action: activeInteractionVisual } as WhiteboardStep;
  }, [isInteraction, activeInteractionVisual]);

  const interactionVisualIds = useMemo(
    () => (interactionVisualStep ? new Set([-1]) : null),
    [interactionVisualStep],
  );

  // ── Narration state ──────────────────────────────────────────────────

  const [isNarrating, setIsNarrating] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const advanceRef = useRef(wrappedAdvance);
  advanceRef.current = wrappedAdvance;
  // Set synchronously by the narration effect (below) so the auto-advance
  // effect — which fires in the same commit — knows whether this step has
  // narration before isNarrating/isTtsLoading state has had a chance to
  // update. Reading those instead would race: they're still false from the
  // previous step until this render's narration effect flips them, so
  // auto-advance would fire prematurely and cut narration off mid-step.
  const stepHasNarrationRef = useRef(false);
  const isChattingRef = useRef(isChatting);
  isChattingRef.current = isChatting;
  const whyModalOpenRef = useRef(whyModalOpen);
  whyModalOpenRef.current = whyModalOpen;

  // Start lesson generation on mount
  useEffect(() => {
    generateLesson();
  }, [generateLesson]);

  // ── Pause lesson when chat opens ─────────────────────────────────────

  useEffect(() => {
    if (isChatting) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsNarrating(false);
      setIsTtsLoading(false);
    }
  }, [isChatting]);

  useEffect(() => {
    if (chat.ttsFailed) {
      toast.error("Couldn't play audio for that response.", { duration: 3000 });
    }
  }, [chat.ttsFailed]);

  const closeChat = useCallback(() => {
    setIsChatting(false);
    chat.clearChat();
  }, [chat]);

  // The voice-input dock is always visible (not gated behind isChatting),
  // so tapping the mic during main-lesson narration must stop THIS audioRef
  // directly — chat.startRecording only knows about its own narration audio.
  // Enter chat mode immediately on tap (same as submitting typed text)
  // instead of waiting for isProcessing, so the student sees they're in the
  // conversation while they're still speaking.
  const handleStartRecording = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsNarrating(false);
    setIsTtsLoading(false);
    setIsChatting(true);
    chat.startRecording();
  }, [chat]);

  // ── TTS narration ──────────────────────────────────────────────────
  // Teaching steps: narrate on arrival (while visual animates)
  // Predict/fill_blank: narrate AFTER student answers (called via playNarration)
  // Check-in: narrate question on arrival

  const playNarration = useCallback((text: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (isChattingRef.current || !text) return;

    setIsTtsLoading(true);
    let cancelled = false;

    const run = async () => {
      try {
        const res = await fetch("/api/agent/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (cancelled || !res.ok) {
          if (!cancelled) { setIsTtsLoading(false); setIsNarrating(false); }
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (!cancelled) setIsNarrating(false);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (!cancelled) setIsNarrating(false);
        };

        if (cancelled || isChattingRef.current) return;

        audio.play().then(() => {
          if (!cancelled && !isChattingRef.current) {
            setIsTtsLoading(false);
            setIsNarrating(true);
          }
        }).catch(() => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (!cancelled) { setIsTtsLoading(false); setIsNarrating(false); }
        });
      } catch {
        if (!cancelled) { setIsTtsLoading(false); setIsNarrating(false); }
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  // Auto-narrate all steps on arrival:
  // teaching: narrates the displayText/narration (what's being shown)
  // predict/fill_blank/check_in: narrates the QUESTION text so the tutor reads it aloud
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (isChattingRef.current) return;
    if (whyModalOpenRef.current) return;

    const step = whiteboardSteps[userStepIndex];
    if (!step) {
      stepHasNarrationRef.current = false;
      return;
    }

    let narration: string | undefined;
    if (step.action.type === "check_in") {
      narration = (step.action as CheckInAction).question.trim();
    } else if (step.action.type === "predict") {
      narration = (step.action as PredictAction).question.trim();
    } else if (step.action.type === "fill_blank") {
      narration = (step.action as FillBlankAction).prompt.trim();
    } else {
      narration = step.narration?.trim();
    }
    if (!narration) {
      stepHasNarrationRef.current = false;
      return;
    }

    stepHasNarrationRef.current = true;
    const cancel = playNarration(narration);

    return () => {
      cancel?.();
      setIsTtsLoading(false);
      setIsNarrating(false);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userStepIndex, playNarration]);

  // ── Auto-advance teaching steps when narration + animation done ─────

  useEffect(() => {
    const step = whiteboardSteps[userStepIndex];
    if (!step) return;
    // Only auto-advance teaching steps (not interactions)
    const t = step.action.type;
    if (t === "check_in" || t === "predict" || t === "fill_blank") return;
    if (isLastStep) return;
    if (isChatting) return;
    if (whyModalOpen) return;

    if (playerState !== "waiting") return;
    // If this step has narration, only advance once it's actually finished
    // (isNarrating/isTtsLoading both false is only trustworthy here because
    // stepHasNarrationRef was just set synchronously by the narration effect
    // above, in the same commit).
    if (stepHasNarrationRef.current && (isNarrating || isTtsLoading)) return;

    advanceRef.current();
  }, [playerState, isNarrating, isTtsLoading, isLastStep, isChatting, whyModalOpen, userStepIndex, whiteboardSteps]);

  // Callback for predict/fill_blank: play narration after student answers, then advance after delay
  const handleInteractionAnswer = useCallback(() => {
    // Brief delay so the student can read the explanation before advancing
    setTimeout(() => advanceRef.current(), 1200);
  }, []);

  // Transition to practice phase when lesson completes — but not while the
  // last step's narration is still playing (isLastStep only reflects the
  // visual clip-path animation finishing, which is usually faster than TTS).
  useEffect(() => {
    if (stepHasNarrationRef.current && (isNarrating || isTtsLoading)) return;
    if (isLastStep && lessonPhase === "lesson") {
      setLessonPhase("practice");
      // If problems weren't pre-fetched, fetch now
      if (!providedPracticeProblems && fetchedPracticeProblems.length === 0 && !prefetchedRef.current) {
        fetchPracticeProblems();
      }
    }
  }, [isLastStep, lessonPhase, isNarrating, isTtsLoading, providedPracticeProblems, fetchedPracticeProblems.length, fetchPracticeProblems]);

  // Mark complete when all practice problems are done
  useEffect(() => {
    if (lessonPhase === "practice" && activePracticeProblems.length > 0 && currentProblemIndex >= activePracticeProblems.length) {
      setLessonPhase("complete");
    }
  }, [lessonPhase, activePracticeProblems.length, currentProblemIndex]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // ── Chat input handlers ──────────────────────────────────────────────

  // Auto-resize textarea
  useEffect(() => {
    const ta = chatTextareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 56) + "px";
  }, [chatInput]);

  // Scroll chat history on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [chat.chatMessages]);

  // Auto-scroll left panel when content changes (new narration, hint/explanation appear)
  useEffect(() => {
    const el = contentScrollRef.current;
    if (!el || isChatting) return;

    let timer: ReturnType<typeof setTimeout>;
    const scrollToBottom = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (el.scrollHeight > el.clientHeight) {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        }
      }, 80);
    };

    const observer = new MutationObserver(scrollToBottom);
    observer.observe(el, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [isChatting]);

  const handleChatSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!chatInput.trim() || chat.isProcessing) return;
      setIsChatting(true);
      chat.sendChat(chatInput.trim());
      setChatInput("");
      if (chatTextareaRef.current) chatTextareaRef.current.style.height = "auto";
    },
    [chatInput, chat],
  );

  // Auto-enter chat mode when voice recording triggers processing
  useEffect(() => {
    if (chat.isProcessing && !isChatting) {
      setIsChatting(true);
    }
  }, [chat.isProcessing, isChatting]);

  const handleChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleChatSubmit(e);
      }
    },
    [handleChatSubmit],
  );

  // ── Derived state ────────────────────────────────────────────────────

  const currentDisplayText = whiteboardSteps[userStepIndex]?.displayText
    ?? whiteboardSteps[userStepIndex]?.narration ?? "";
  const hasChatSteps = chat.chatWhiteboardSteps.length > 0;
  // Memoized so WhiteboardCanvas's `steps` prop is referentially stable
  // across renders — an inline `[interactionVisualStep]` array literal here
  // would recreate on every render and (via WhiteboardCanvas's layout/
  // onStepFocus effects, which depend on `steps`) trigger a render loop.
  const canvasSteps = useMemo(
    () =>
      interactionVisualStep
        ? [interactionVisualStep]
        : isChatting && hasChatSteps
          ? chat.chatWhiteboardSteps
          : whiteboardSteps,
    [interactionVisualStep, isChatting, hasChatSteps, chat.chatWhiteboardSteps, whiteboardSteps],
  );
  const emptyVisibleIds = useMemo(() => new Set<number>(), []);
  const isPracticeCanvas = (lessonPhase === "practice" || lessonPhase === "complete") && !isChatting;

  const voiceOrbState: "idle" | "listening" | "processing" | "speaking" =
    chat.isRecording ? "listening" : chat.isProcessing ? "processing" : chat.isSpeaking ? "speaking" : "idle";

  // ── Generating state ──────────────────────────────────────────────
  const isGenerating = phase === "generating" && whiteboardSteps.length === 0;

  // ── Character state ────────────────────────────────────────────────
  const pixelEmotion: "neutral" | "happy" | "thinking" | "encouraging" = isGenerating
    ? "thinking"
    : isChatting
      ? (chat.isProcessing ? "thinking" : chat.isChatNarrating ? "happy" : "neutral")
      : lessonPhase === "practice" || lessonPhase === "complete"
        ? "encouraging"
        : isInteraction
          ? "encouraging"
          : isTtsLoading
            ? "thinking"
            : isNarrating
              ? "happy"
              : "neutral";
  const pixelTalking = isNarrating || chat.isChatNarrating;
  const pixelLoading = isTtsLoading && !pixelTalking;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <BookOpen className="h-4 w-4 text-athena-amber" />
          <h3 className="text-sm font-semibold">
            {lessonPhase === "practice" || lessonPhase === "complete"
              ? `Practice: ${subtopic}`
              : `Micro-Lesson: ${subtopic}`}
          </h3>
          {phase === "generating" && (
            <motion.span
              className="text-xs text-muted-foreground"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              Generating lesson…
            </motion.span>
          )}
        </div>
        <motion.button
          onClick={() => setWhyModalOpen(true)}
          className="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-amber-300 cursor-pointer overflow-hidden"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {/* Siri-style animated gradient glow */}
          <motion.div
            className="absolute inset-0 rounded-full opacity-60"
            style={{
              background:
                "linear-gradient(135deg, rgba(251,191,36,0.25), rgba(244,114,182,0.2), rgba(129,140,248,0.2), rgba(251,191,36,0.25))",
              backgroundSize: "300% 300%",
            }}
            animate={{
              backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* Soft pulsing border glow */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.3)",
            }}
            animate={{
              boxShadow: [
                "inset 0 0 0 1px rgba(251,191,36,0.3), 0 0 6px rgba(251,191,36,0.15)",
                "inset 0 0 0 1px rgba(244,114,182,0.3), 0 0 10px rgba(244,114,182,0.2)",
                "inset 0 0 0 1px rgba(129,140,248,0.3), 0 0 6px rgba(129,140,248,0.15)",
                "inset 0 0 0 1px rgba(251,191,36,0.3), 0 0 6px rgba(251,191,36,0.15)",
              ],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="relative flex items-center gap-1.5"
            animate={{
              color: ["#fbbf24", "#f472b6", "#818cf8", "#fbbf24"],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Lore</span>
          </motion.div>
        </motion.button>
      </div>

      {/* Error state */}
      {phase === "error" ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <p className="text-sm text-destructive">
            Failed to generate lesson. Please try again.
          </p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Go Back
          </Button>
        </div>
      ) : (
        /* Left panel + canvas */
        <div className="flex flex-1 min-h-0">
          {/* Left panel — tutor */}
          <div className="w-[20%] min-w-[240px] max-w-[320px] flex flex-col border-r bg-card overflow-hidden">
            {/* Character — top of panel */}
            <div className="shrink-0 flex flex-col items-center gap-0.5 px-4 pt-4 pb-2">
              <PixelCharacter
                emotion={pixelEmotion}
                isTalking={pixelTalking}
                size={48}
              />
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground font-medium">
                  Athena
                </span>
                {(pixelTalking || pixelLoading) && (
                  <div className="flex items-center gap-[2px]">
                    {[0, 1, 2, 3].map((i) => (
                      <motion.div
                        key={i}
                        className={cn(
                          "w-[2px] rounded-full",
                          pixelTalking ? "bg-athena-amber/50" : "bg-athena-amber/30"
                        )}
                        animate={
                          pixelTalking
                            ? { height: [3, 8 + i * 2, 3] }
                            : { height: [3, 5, 3], opacity: [0.3, 0.6, 0.3] }
                        }
                        transition={{
                          duration: pixelTalking ? 0.4 : 1.0,
                          repeat: Infinity,
                          delay: i * 0.1,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Scrollable content area — narration/check-in/chat messages */}
            <div
              className="flex-1 min-h-0 overflow-y-auto scroll-smooth px-4 pb-3"
              ref={isChatting ? chatScrollRef : contentScrollRef}
            >
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <motion.div
                    key="generating"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-center h-full pt-4"
                  >
                    <GenerationProgress />
                  </motion.div>
                ) : isChatting ? (
                  /* ── Chat messages — user bubbles + step-based tutor response ── */
                  <motion.div
                    key="chat-messages"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-2 pt-1"
                  >
                    <button
                      onClick={closeChat}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      &larr; {lessonPhase === "practice" ? "Back to practice" : "Resume lesson"}
                    </button>

                    {/* Show only the last user question (full history still sent to agent) */}
                    {(() => {
                      const lastUserMsg = chat.chatMessages.findLast((msg) => msg.role === "user");
                      return lastUserMsg ? <MessageBubble key="user-last" role="user" content={lastUserMsg.content} /> : null;
                    })()}

                    {/* Tutor response: current step's displayText via MathContent */}
                    {chat.chatWhiteboardSteps.length > 0 && chat.chatNarrationIndex >= 0 && (
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={`chat-step-${Math.min(chat.chatNarrationIndex, chat.chatWhiteboardSteps.length - 1)}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="text-sm text-foreground min-h-[2.5rem] mb-2">
                            <MathContent
                              content={
                                chat.chatWhiteboardSteps[
                                  Math.min(chat.chatNarrationIndex, chat.chatWhiteboardSteps.length - 1)
                                ]?.displayText || ""
                              }
                            />
                          </div>
                        </motion.div>
                      </AnimatePresence>
                    )}

                    {/* Thinking indicator while waiting for first step */}
                    <AnimatePresence>
                      {chat.isProcessing && chat.chatWhiteboardSteps.length === 0 && (
                          <ThinkingIndicator variant="prominent" />
                        )}
                    </AnimatePresence>
                  </motion.div>
                ) : (lessonPhase === "practice" || lessonPhase === "complete") && !isChatting ? (
                  /* ── Inline practice problems ── */
                  <motion.div
                    key="practice"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-3 pt-1"
                  >
                    {isPracticeLoading && activePracticeProblems.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 pt-4">
                        <motion.div
                          animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.15, 1] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        >
                          <Sparkles className="h-6 w-6 text-athena-amber" />
                        </motion.div>
                        <p className="text-xs text-muted-foreground">Preparing practice…</p>
                      </div>
                    ) : lessonPhase === "complete" ? (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3 text-center pt-4"
                      >
                        <CheckInConfetti />
                        <div className="flex flex-col items-center gap-1">
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 200, damping: 15 }}
                          >
                            <CheckCircle className="h-10 w-10 text-green-500" />
                          </motion.div>
                          <p className="text-sm font-semibold">
                            {practiceCorrectCount}/{activePracticeProblems.length} correct
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {practiceCorrectCount === activePracticeProblems.length
                              ? "Perfect! Great work on this lesson."
                              : "Keep it up, you're making progress!"}
                          </p>
                        </div>
                        <Button size="sm" className="gap-1" onClick={onClose}>
                          Done
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </motion.div>
                    ) : currentPracticeProblem ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Practice {currentProblemIndex + 1} of {activePracticeProblems.length}
                          </span>
                          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-athena-amber rounded-full"
                              animate={{ width: `${(currentProblemIndex / activePracticeProblems.length) * 100}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        </div>
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={currentPracticeProblem.id}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                          >
                            <PracticeGradientCard
                              problem={currentPracticeProblem}
                              questionNumber={currentProblemIndex + 1}
                              onCorrect={() => {
                                setPracticeCorrectCount((c) => c + 1);
                                setCurrentProblemIndex((i) => i + 1);
                              }}
                              onExhausted={() => {
                                setCurrentProblemIndex((i) => i + 1);
                              }}
                            />
                          </motion.div>
                        </AnimatePresence>
                      </>
                    ) : null}
                  </motion.div>
                ) : isCheckIn && currentCheckIn ? (
                  /* ── Check-in ── */
                  <motion.div
                    key="check-in"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <CheckInCard
                      key={`check-in-${userStepIndex}`}
                      checkIn={currentCheckIn}
                      onAnswer={wrappedAdvance}
                      onNarrate={(text) => playNarration(text)}
                      onHintPhase={setInteractionHintPhase}
                    />
                  </motion.div>
                ) : currentPrediction ? (
                  /* ── Predict ── */
                  <motion.div
                    key={`predict-${userStepIndex}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <PredictCard
                      predict={currentPrediction}
                      onAnswer={handleInteractionAnswer}
                      onNarrate={(text) => playNarration(text)}
                      onHintPhase={setInteractionHintPhase}
                    />
                  </motion.div>
                ) : currentFillBlank ? (
                  /* ── Fill blank ── */
                  <motion.div
                    key={`fill-blank-${userStepIndex}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <FillBlankCard
                      fillBlank={currentFillBlank}
                      onAnswer={handleInteractionAnswer}
                      onNarrate={(text) => playNarration(text)}
                      onHintPhase={setInteractionHintPhase}
                    />
                  </motion.div>
                ) : (
                  /* ── Teaching step or last step ── */
                  <motion.div
                    key={`narration-${userStepIndex}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="text-sm text-foreground min-h-[2.5rem] mb-2">
                      <MathContent content={currentDisplayText} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Chat input — always visible at bottom of left panel */}
            <div className="shrink-0 border-t px-4 py-3">
              {chat.mode === "text" ? (
                <form onSubmit={handleChatSubmit}>
                  <textarea
                    ref={chatTextareaRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder={lessonPhase === "practice" ? "Ask about this problem…" : "Ask about this lesson…"}
                    className="w-full bg-muted/50 rounded-lg text-sm outline-none placeholder:text-muted-foreground resize-none min-h-[36px] max-h-[56px] py-2 px-3"
                    rows={1}
                    disabled={isGenerating || chat.isProcessing}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={chat.toggleMode}
                      title="Switch to voice"
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                    <motion.div
                      whileTap={{ scale: 0.9, rotate: -12 }}
                      transition={{ type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <Button
                        type="submit"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        disabled={!chatInput.trim() || chat.isProcessing}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  </div>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="scale-75 origin-center">
                    <VoiceOrb
                      state={voiceOrbState}
                      amplitude={chat.amplitude}
                      onTap={
                        chat.isRecording
                          ? chat.stopRecording
                          : handleStartRecording
                      }
                      disabled={chat.isProcessing && !chat.isRecording}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground text-center">
                    {chat.isRecording
                      ? "Listening… tap to stop"
                      : chat.isProcessing
                        ? "Processing…"
                        : chat.isSpeaking
                          ? "Speaking…"
                          : "Tap to speak"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-xs"
                    onClick={chat.toggleMode}
                  >
                    <Keyboard className="h-3.5 w-3.5" />
                    Text
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right panel — canvas */}
          <div className={`flex-1 min-h-0 ${interactionVisualStep && (interactionVisualStep.action.type === "coordinate_plane" || interactionVisualStep.action.type === "geometry") ? "flex items-center justify-center p-4" : ""}`}>
           <AnimatePresence mode="wait">
            {isGenerating ? (
              <motion.div
                key="skeleton"
                className="h-full w-full"
                exit={{ opacity: 0, scale: 1.02, filter: "blur(4px)" }}
                transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <WhiteboardSkeleton className="h-full" />
              </motion.div>
            ) : interactionVisualStep && (interactionVisualStep.action.type === "coordinate_plane" || interactionVisualStep.action.type === "geometry") ? (
            <motion.div key={`interaction-visual-${interactionHintPhase}`} className="w-full h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <svg
                viewBox="0 0 520 460"
                className="max-w-full max-h-full"
                preserveAspectRatio="xMidYMid meet"
              >
                {interactionVisualStep.action.type === "coordinate_plane" ? (
                  <WbCoordinatePlane
                    action={interactionVisualStep.action as CoordinatePlaneAction}
                    x={10} y={10} width={500} height={440}
                    progress={1} isAnimating={false}
                  />
                ) : (
                  <WbGeometry
                    action={interactionVisualStep.action as GeometryAction}
                    x={10} y={10} width={500} height={440}
                    progress={1} isAnimating={false}
                  />
                )}
              </svg>
            </motion.div>
           ) : (
            <motion.div
              key={interactionVisualStep ? `canvas-${interactionHintPhase}` : "canvas"}
              className={`h-full w-full ${isChatting && hasChatSteps ? "min-h-[400px]" : ""}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
            <WhiteboardCanvas
              steps={canvasSteps}
              visibleStepIds={
                isPracticeCanvas ? emptyVisibleIds
                : interactionVisualIds ? interactionVisualIds
                : isChatting && hasChatSteps ? chatVisibleIds
                : visibleStepIds
              }
              currentStepIndex={
                interactionVisualStep ? 0
                : isChatting && hasChatSteps
                  ? Math.min(Math.max(chat.chatNarrationIndex, 0), chat.chatWhiteboardSteps.length - 1)
                  : currentStepIndex
              }
              stepProgress={
                interactionVisualStep ? 1
                : isChatting && hasChatSteps ? 1
                : stepProgress
              }
              equalScaleCoords
              onStepFocus={setStepFocus}
            />
            </motion.div>
           )}
           </AnimatePresence>
          </div>
        </div>
      )}
      <WhyThisMattersModal
        open={whyModalOpen}
        onOpenChange={setWhyModalOpen}
        topic={topic}
        subtopic={subtopic}
        metadata={metadata}
        loreApiPath={subtopicApiPath?.replace(/\/micro-lesson$/, "/lore")}
      />
      <LessonTeachingPointer
        stepFocus={stepFocus}
        stepProgress={stepProgress}
        active={!isInteraction && !isChatting}
      />
    </div>
  );
}
