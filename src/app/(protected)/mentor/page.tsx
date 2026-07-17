"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, Mic, Keyboard, GraduationCap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMentorConversation } from "@/hooks/use-mentor-conversation";
import { MessageBubble } from "@/components/lessons/message-bubble";
import { VoiceOrb } from "@/components/lessons/voice-orb";
import { ThinkingIndicator } from "@/components/lessons/thinking-indicator";
import { WhiteboardCanvas } from "@/components/whiteboard/whiteboard-canvas";
import { WhiteboardToolbar } from "@/components/whiteboard/whiteboard-toolbar";
import { WhiteboardTimeline } from "@/components/whiteboard/whiteboard-timeline";
import { useWhiteboardPlayer } from "@/hooks/use-whiteboard-player";
import { MentorScheduleTab } from "@/components/mentor/schedule-tab";
import type { SelectedElement } from "@/types/whiteboard";

const SUGGESTIONS = [
  "How am I doing overall?",
  "What should I focus on this week?",
  "Help me make a study plan",
  "I'm feeling stuck on math",
];

export default function MentorPage() {
  const [tab, setTab] = useState<"chat" | "schedule">("chat");
  const [input, setInput] = useState("");
  const [selections, setSelections] = useState<SelectedElement[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

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
  } = useMentorConversation();

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

  const hasWhiteboard = whiteboardSteps.length > 0;

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isProcessing]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isWhiteboardStreaming) setSelections([]);
  }, [isWhiteboardStreaming]);

  const handleElementSelect = useCallback(
    (el: SelectedElement | null) => {
      if (!el) {
        setSelections([]);
        return;
      }
      setSelections([el]);
      const q =
        el.type === "write_math"
          ? `Can you explain this step: $${el.content}$?`
          : `Can you explain this further: "${el.content}"?`;
      setInput(q);
      if (mode === "voice") toggleMode();
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [mode, toggleMode]
  );

  const handleElementToggle = useCallback((el: SelectedElement) => {
    setSelections((prev) => {
      const key = `${el.stepId}:${el.content}`;
      const exists = prev.some((s) => `${s.stepId}:${s.content}` === key);
      return exists
        ? prev.filter((s) => `${s.stepId}:${s.content}` !== key)
        : [...prev, el];
    });
  }, []);

  const handleElementsSelect = useCallback(
    (els: SelectedElement[]) => {
      setSelections(els);
      if (mode === "voice") toggleMode();
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [mode, toggleMode]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    sendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSuggestion = (text: string) => {
    sendMessage(text);
  };

  // Narration can now start before generation finishes (sentence-by-sentence
  // streaming), so isSpeaking takes priority over isProcessing once it's true.
  const voiceOrbState: "idle" | "listening" | "processing" | "speaking" =
    isRecording
      ? "listening"
      : isSpeaking
        ? "speaking"
        : isProcessing
          ? "processing"
          : "idle";

  return (
    <div className="flex h-[calc(100dvh-64px)]">
      {/* Chat column */}
      <div
        className={`flex flex-col transition-all duration-300 ${
          hasWhiteboard ? "w-1/2 border-r" : "mx-auto w-full max-w-2xl"
        }`}
      >
        {/* Tab bar */}
        <div className="flex shrink-0 border-b">
          <button
            onClick={() => setTab("chat")}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              tab === "chat"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab("schedule")}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              tab === "schedule"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Schedule
          </button>
        </div>

        {/* Schedule tab */}
        {tab === "schedule" && <MentorScheduleTab />}

        {/* Chat contents — hidden (not unmounted) while on schedule tab to preserve state */}
        <div className={`flex min-h-0 flex-1 flex-col ${tab === "schedule" ? "hidden" : ""}`}>

        {/* Scrollable messages area */}
        <div
          ref={scrollRef}
          onScroll={checkNearBottom}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {/* Welcome state */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <GraduationCap className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-1">
                <h1 className="text-xl font-semibold tracking-tight">
                  CPA Exam Prep Mentor
                </h1>
                <p className="text-sm text-muted-foreground max-w-sm">
                  I&apos;m your personal CPA exam coach. I know your progress, your
                  strengths, and where you can improve. Ask me anything.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSuggestion(s)}
                    className="rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <MessageBubble
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.isStreaming}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Thinking indicator */}
          <AnimatePresence>
            {isProcessing && !messages.some((m) => m.isStreaming) && (
              <ThinkingIndicator />
            )}
          </AnimatePresence>

          {/* Speaking indicator */}
          {isSpeaking && !isProcessing && (
            <motion.p
              className="text-xs text-muted-foreground px-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Athena is speaking...
            </motion.p>
          )}
        </div>

        {/* Input area */}
        {mode === "text" ? (
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 border-t p-3"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your mentor anything..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground resize-none min-h-[36px] max-h-[120px] py-2"
              rows={1}
              disabled={isProcessing}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={toggleMode}
              title="Switch to voice mode"
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
                disabled={!input.trim() || isProcessing}
              >
                <Send className="h-4 w-4" />
              </Button>
            </motion.div>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-4 border-t p-6">
            <VoiceOrb
              state={voiceOrbState}
              amplitude={amplitude}
              onTap={isRecording ? stopRecording : startRecording}
              disabled={isProcessing && !isRecording && !isSpeaking}
            />
            <p className="text-sm text-muted-foreground">
              {isRecording
                ? "Listening... tap to stop"
                : isSpeaking
                  ? "Speaking..."
                  : isProcessing
                    ? "Processing..."
                    : "Tap to speak"}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-xs"
              onClick={toggleMode}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Switch to text
            </Button>
          </div>
        )}
        </div>{/* end chat wrapper */}
      </div>

      {/* Whiteboard panel */}
      <AnimatePresence>
        {hasWhiteboard && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "50%" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex flex-col overflow-hidden"
          >
            <WhiteboardToolbar
              state={playerState}
              speed={speed}
              currentStep={currentStepIndex}
              totalSteps={whiteboardSteps.length}
              isStreaming={isWhiteboardStreaming}
              onPlay={play}
              onPause={pause}
              onReplay={replay}
              onSpeedChange={changeSpeed}
            />

            <div className="flex-1 min-h-0">
              <WhiteboardCanvas
                steps={whiteboardSteps}
                visibleStepIds={visibleStepIds}
                currentStepIndex={currentStepIndex}
                stepProgress={stepProgress}
                selections={selections}
                onElementSelect={handleElementSelect}
                onElementToggle={handleElementToggle}
                onElementsSelect={handleElementsSelect}
              />
            </div>

            {whiteboardSteps.length > 1 && (
              <WhiteboardTimeline
                totalSteps={whiteboardSteps.length}
                currentStep={currentStepIndex}
                visibleStepIds={visibleStepIds}
                stepIds={whiteboardSteps.map((s) => s.id)}
                onSeek={seekToStep}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
