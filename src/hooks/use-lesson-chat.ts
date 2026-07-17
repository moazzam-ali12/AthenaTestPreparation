"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAudioAnalyzer } from "./use-audio-analyzer";
import { trimHistory } from "@/lib/trim-history";
import type { WhiteboardStep } from "@/types/whiteboard";
import type { Problem } from "@/components/quiz/types";

export type ChatMessage = {
  role: "user" | "tutor";
  content: string;
  isStreaming?: boolean;
};

type SubtopicMetadata = {
  learningObjectives?: string[];
  keyFormulas?: { latex: string; description: string }[];
  commonMistakes?: { mistake: string; correction: string; why: string }[];
  tipsAndTricks?: string[];
};

type UseLessonChatOptions = {
  topic: string;
  subtopic: string;
  lessonContent: string;
  metadata?: SubtopicMetadata;
  whiteboardSteps?: WhiteboardStep[];
  currentStepIndex?: number;
  chatStreamUrl?: string;
  currentPracticeProblem?: Problem | null;
};

/**
 * Lightweight chat hook for mid-lesson Q&A.
 *
 * Completely independent from useMicroLesson — keeps its own message
 * and whiteboard state so the lesson player is never affected.
 *
 * Chat responses are whiteboard-step-only: each step has narration
 * (speech-friendly) + displayText (KaTeX) + action (canvas visual).
 * Steps are narrated one at a time via TTS, synced with display.
 */
export function useLessonChat({
  topic,
  subtopic,
  lessonContent,
  metadata,
  whiteboardSteps: lessonStepsRaw,
  currentStepIndex = 0,
  chatStreamUrl,
  currentPracticeProblem,
}: UseLessonChatOptions) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatWhiteboardSteps, setChatWhiteboardSteps] = useState<WhiteboardStep[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsFailed, setTtsFailed] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [isRecording, setIsRecording] = useState(false);

  // Per-step narration state
  const [chatNarrationIndex, setChatNarrationIndex] = useState(-1);
  const [isChatNarrating, setIsChatNarrating] = useState(false);
  const [chatStreamDone, setChatStreamDone] = useState(false);

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = chatMessages;
  const nextStepIdRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatStepsRef = useRef<WhiteboardStep[]>([]);
  chatStepsRef.current = chatWhiteboardSteps;
  // Mirrors `isRecording` for the narration effect below, so a TTS fetch that
  // resolves mid-recording (started before the student tapped the mic) can
  // bail instead of playing narration into a live mic capture.
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;

  const {
    amplitude,
    connectStream: connectAudioStream,
    connectElement: connectAudioElement,
    disconnect: disconnectAudio,
  } = useAudioAnalyzer();

  // ── SSE stream parser (text + whiteboard steps) ──────────────────

  const parseStream = useCallback(
    async (res: Response, onToken: (token: string) => void) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.token) {
                fullContent += parsed.token;
                onToken(parsed.token);
              }
              if (parsed.wb_step) {
                const step = {
                  ...parsed.wb_step,
                  id: nextStepIdRef.current++,
                } as WhiteboardStep;
                setChatWhiteboardSteps((prev) => [...prev, step]);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      } finally {
        // flush remaining
      }

      return fullContent;
    },
    [],
  );

  // ── Send chat message ────────────────────────────────────────────

  const sendChat = useCallback(
    async (text: string) => {
      if (!text.trim() || isProcessing) return;

      // Clear previous chat whiteboard steps for fresh canvas
      setChatWhiteboardSteps([]);
      nextStepIdRef.current = 0;
      setTtsFailed(false);
      setChatNarrationIndex(-1);
      setIsChatNarrating(false);
      setChatStreamDone(false);

      setChatMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsProcessing(true);

      // Add streaming placeholder
      setChatMessages((prev) => [
        ...prev,
        { role: "tutor", content: "", isStreaming: true },
      ]);

      const history = trimHistory(
        messagesRef.current
          .filter((m) => !m.isStreaming)
          .map((m) => ({
            role: m.role === "tutor" ? "assistant" : "user",
            content: m.content,
          }))
      );

      try {
        const res = await fetch(
          chatStreamUrl ?? "/api/agent/micro-lesson/chat/stream",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: text,
              topic,
              subtopic,
              lessonSummary: lessonContent,
              lessonSteps: lessonStepsRaw?.map((step, i) => ({
                index: i,
                type: step.action.type === "check_in" ? "check_in" : "teaching",
                narration: step.narration || "",
                actionType: step.action.type,
                ...(step.action.type === "check_in"
                  ? {
                      question: (step.action as { question: string }).question,
                      options: (step.action as { options: string[] }).options,
                      correctOption: (step.action as { correctOption: number }).correctOption,
                      hint: (step.action as { hint?: string }).hint,
                    }
                  : {}),
              })),
              metadata: metadata || {},
              currentStepIndex,
              history,
              ...(currentPracticeProblem ? {
                currentPracticeProblem: {
                  questionText: currentPracticeProblem.questionText,
                  options: currentPracticeProblem.options,
                  correctOption: currentPracticeProblem.correctOption,
                  hint: currentPracticeProblem.hint,
                  explanation: currentPracticeProblem.explanation,
                  solutionSteps: currentPracticeProblem.solutionSteps,
                },
              } : {}),
            }),
          },
        );

        if (!res.ok || !res.body) throw new Error("Stream failed");

        await parseStream(res, (token) => {
          setChatMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "tutor" && last.isStreaming) {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + token,
              };
            }
            return updated;
          });
        });

        // Fallback: if no whiteboard steps arrived, synthesize one from the text
        // so the per-step TTS narration system still fires.
        if (chatStepsRef.current.length === 0) {
          const lastMsg = messagesRef.current[messagesRef.current.length - 1];
          const fallbackText = lastMsg?.content?.trim();
          if (fallbackText) {
            const syntheticStep: WhiteboardStep = {
              id: nextStepIdRef.current++,
              delayMs: 0,
              narration: fallbackText,
              displayText: fallbackText,
              durationMs: 0,
              action: { type: "write_text", text: fallbackText, style: { fontSize: "md" } },
            };
            setChatWhiteboardSteps([syntheticStep]);
          }
        }

        // Mark streaming done
        setChatMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "tutor" && last.isStreaming) {
            updated[updated.length - 1] = { ...last, isStreaming: false };
          }
          return updated;
        });
        setChatStreamDone(true);
      } catch {
        setChatMessages((prev) => [
          ...prev.filter((m) => !m.isStreaming),
          {
            role: "tutor",
            content: "I'm having trouble connecting right now. Please try again.",
          },
        ]);
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, topic, subtopic, lessonContent, metadata, lessonStepsRaw, currentStepIndex, chatStreamUrl, parseStream, currentPracticeProblem],
  );

  // ── Per-step narration ─────────────────────────────────────────

  // Start narrating the first step when it arrives
  useEffect(() => {
    if (
      chatWhiteboardSteps.length > 0 &&
      chatNarrationIndex === -1 &&
      !isChatNarrating
    ) {
      setChatNarrationIndex(0);
    }
  }, [chatWhiteboardSteps.length, chatNarrationIndex, isChatNarrating]);

  // Play TTS for the current chat step
  useEffect(() => {
    if (chatNarrationIndex < 0) return;
    const step = chatStepsRef.current[chatNarrationIndex];
    if (!step) return;

    const narration = step.narration?.trim();
    if (!narration) {
      // No narration on this step — advance immediately
      setChatNarrationIndex((prev) => prev + 1);
      return;
    }

    let cancelled = false;
    setIsChatNarrating(true);
    setIsSpeaking(true);

    (async () => {
      try {
        const res = await fetch("/api/agent/text-to-speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: narration }),
        });
        if (cancelled || !res.ok) {
          if (!cancelled) {
            setIsChatNarrating(false);
            setIsSpeaking(false);
            if (!res.ok) setTtsFailed(true);
          }
          return;
        }

        const blob = await res.blob();
        if (cancelled) return;

        // The student started recording while this fetch was in flight —
        // don't play narration into a live mic capture. Skip this step.
        if (isRecordingRef.current) {
          setIsChatNarrating(false);
          setIsSpeaking(false);
          setChatNarrationIndex((prev) => prev + 1);
          return;
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        try { connectAudioElement(audio); } catch { /* optional */ }

        audio.onended = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (cancelled) return;
          setIsSpeaking(false);
          disconnectAudio();
          setIsChatNarrating(false);
          setChatNarrationIndex((prev) => prev + 1);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (cancelled) return;
          setIsSpeaking(false);
          disconnectAudio();
          setIsChatNarrating(false);
          setChatNarrationIndex((prev) => prev + 1);
        };

        if (cancelled) return;
        audio.play().catch(() => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          if (!cancelled) {
            setIsSpeaking(false);
            setIsChatNarrating(false);
            setChatNarrationIndex((prev) => prev + 1);
          }
        });
      } catch {
        if (!cancelled) {
          setIsChatNarrating(false);
          setIsSpeaking(false);
          setTtsFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      disconnectAudio();
    };
  }, [chatNarrationIndex, connectAudioElement, disconnectAudio]);

  // When all steps are narrated, populate the tutor message for history
  useEffect(() => {
    if (
      chatStreamDone &&
      !isChatNarrating &&
      chatWhiteboardSteps.length > 0 &&
      chatNarrationIndex >= chatWhiteboardSteps.length
    ) {
      const combined = chatWhiteboardSteps
        .map((s) => s.displayText || s.narration || "")
        .join("\n");
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastTutorIdx = updated.findLastIndex((m) => m.role === "tutor");
        if (lastTutorIdx >= 0) {
          updated[lastTutorIdx] = {
            ...updated[lastTutorIdx],
            content: combined,
            isStreaming: false,
          };
        }
        return updated;
      });
    }
  }, [chatStreamDone, isChatNarrating, chatNarrationIndex, chatWhiteboardSteps]);

  // ── Voice recording ──────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    // Barge-in: stop any in-progress TTS narration so it doesn't keep
    // talking over the student while they record their voice input.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setIsChatNarrating(false);
    disconnectAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { connectAudioStream(stream); } catch { /* optional */ }

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        disconnectAudio();

        // Transcribe and send
        setIsProcessing(true);
        try {
          const form = new FormData();
          form.append("audio", blob);
          const res = await fetch("/api/agent/speech-to-text", {
            method: "POST",
            body: form,
          });
          if (!res.ok) throw new Error("Transcription failed");
          const { text } = await res.json();
          if (text?.trim()) {
            await sendChat(text.trim());
          } else {
            setChatMessages((prev) => [
              ...prev,
              { role: "tutor", content: "I couldn't hear that. Please try again." },
            ]);
          }
        } catch {
          setChatMessages((prev) => [
            ...prev,
            { role: "tutor", content: "I couldn't hear that. Please try again." },
          ]);
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      // Microphone access denied
    }
  }, [sendChat, connectAudioStream, disconnectAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const toggleMode = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setIsChatNarrating(false);
    disconnectAudio();
    if (isRecording) stopRecording();
    setMode((prev) => (prev === "text" ? "voice" : "text"));
  }, [isRecording, stopRecording, disconnectAudio]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatWhiteboardSteps([]);
    nextStepIdRef.current = 0;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setIsProcessing(false);
    setChatNarrationIndex(-1);
    setIsChatNarrating(false);
    setChatStreamDone(false);
  }, []);

  // Stop audio on unmount handled by the component

  return {
    chatMessages,
    chatWhiteboardSteps,
    isProcessing,
    isSpeaking,
    ttsFailed,
    mode,
    isRecording,
    amplitude,
    chatNarrationIndex,
    isChatNarrating,
    chatStreamDone,
    sendChat,
    startRecording,
    stopRecording,
    toggleMode,
    clearChat,
  };
}
