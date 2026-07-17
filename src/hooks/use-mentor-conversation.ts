"use client";

import { useState, useCallback, useRef } from "react";
import { useAudioAnalyzer } from "./use-audio-analyzer";
import { sanitizeForTTS } from "@/lib/sanitize-for-tts";
import type { WhiteboardStep } from "@/types/whiteboard";

export type MentorMessage = {
  role: "user" | "tutor";
  content: string;
  isStreaming?: boolean;
};

type Mode = "text" | "voice";

const MAX_HISTORY = 20;
const WB_MARKER = "<<<WHITEBOARD>>>";
const TTS_MODEL_ID = "eleven_turbo_v2";

/** Pulls whatever complete words are ready out of a growing streamed buffer
 *  (everything up to and including the last space), leaving any still-
 *  incomplete trailing word for the next call. */
function extractReadyWords(buffer: string): { ready: string; rest: string } {
  const lastSpace = buffer.lastIndexOf(" ");
  if (lastSpace === -1) return { ready: "", rest: buffer };
  return { ready: buffer.slice(0, lastSpace + 1), rest: buffer.slice(lastSpace + 1) };
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function useMentorConversation() {
  const [messages, setMessages] = useState<MentorMessage[]>([]);
  const [mode, setMode] = useState<Mode>("text");
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [whiteboardSteps, setWhiteboardSteps] = useState<WhiteboardStep[]>([]);
  const [isWhiteboardStreaming, setIsWhiteboardStreaming] = useState(false);

  const messagesRef = useRef<MentorMessage[]>([]);
  messagesRef.current = messages;

  const nextStepIdRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tokenBufferRef = useRef("");
  const rafRef = useRef<number>(0);

  // Streaming narration session: a direct WebSocket to ElevenLabs fed
  // word-by-word as the LLM response streams in, with audio chunks played
  // back gaplessly via MediaSource as they arrive.
  const wsRef = useRef<WebSocket | null>(null);
  const wsOpenRef = useRef(false);
  const pendingTextRef = useRef("");
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingAudioChunksRef = useRef<Uint8Array[]>([]);
  const streamEndedRef = useRef(false);
  const inputDoneRef = useRef(false);

  // Word-exact text/voice sync. While a narration session owns the display,
  // LLM tokens are NOT flushed to the message bubble; instead ElevenLabs'
  // per-character alignment timestamps drive a reveal loop synced to
  // audio.currentTime, so each character appears exactly as it's spoken.
  const narrationDisplayRef = useRef(false);
  const alignCharsRef = useRef<string[]>([]);
  const alignTimesRef = useRef<number[]>([]); // absolute ms since audio start
  const chunkOffsetMsRef = useRef(0);
  const revealCursorRef = useRef(0);
  const revealRafRef = useRef(0);
  const fullTextRef = useRef("");
  const textDoneRef = useRef(false);

  const {
    amplitude,
    connectStream: connectAudioStream,
    connectElement: connectAudioElement,
    disconnect: disconnectAudio,
  } = useAudioAnalyzer();

  const streamChat = useCallback(async (
    question: string,
    onTextReady?: (text: string) => void,
  ): Promise<string> => {
    const history = messagesRef.current
      .filter((m) => !m.isStreaming)
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role === "tutor" ? "assistant" : "user",
        content: m.content,
      }));

    const res = await fetch("/api/agent/mentor-chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    });

    if (!res.ok || !res.body) {
      throw new Error("Stream failed");
    }

    setMessages((prev) => [
      ...prev,
      { role: "tutor", content: "", isStreaming: true },
    ]);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";
    let receivedWbSteps = false;
    let spokenLen = 0;

    const emitReadyWords = () => {
      if (!onTextReady) return;
      const markerIdx = fullContent.indexOf(WB_MARKER);
      const speakable = markerIdx === -1 ? fullContent : fullContent.slice(0, markerIdx);
      const unconsumed = speakable.slice(spokenLen);
      const { ready, rest } = extractReadyWords(unconsumed);
      if (!ready) return;
      spokenLen += unconsumed.length - rest.length;
      onTextReady(ready);
    };

    const flushTokens = () => {
      // While a narration session owns the display, tokens stay buffered —
      // the alignment reveal loop renders them as they're spoken instead.
      // If the session fails, the flag flips off and the next tick flushes
      // everything accumulated, degrading to normal LLM-driven display.
      if (tokenBufferRef.current && !narrationDisplayRef.current) {
        const pending = tokenBufferRef.current;
        tokenBufferRef.current = "";
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "tutor" && last.isStreaming) {
            updated[updated.length - 1] = {
              ...last,
              content: last.content + pending,
            };
          }
          return updated;
        });
      }
      rafRef.current = requestAnimationFrame(flushTokens);
    };
    rafRef.current = requestAnimationFrame(flushTokens);

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
          if (data === "[DONE]") {
            setIsWhiteboardStreaming(false);
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.token) {
              fullContent += parsed.token;
              tokenBufferRef.current += parsed.token;
              emitReadyWords();
            }
            if (parsed.wb_step) {
              if (!receivedWbSteps) {
                receivedWbSteps = true;
                setIsWhiteboardStreaming(true);
                nextStepIdRef.current = 0;
                setWhiteboardSteps([]);
              }
              const step = {
                ...parsed.wb_step,
                id: nextStepIdRef.current++,
              } as WhiteboardStep;
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
    } finally {
      cancelAnimationFrame(rafRef.current);
      setIsWhiteboardStreaming(false);
      // Flush whatever's left as the final word(s) (e.g. the response ends
      // without trailing whitespace, or mid-word at a stream cutoff).
      if (onTextReady) {
        const markerIdx = fullContent.indexOf(WB_MARKER);
        const speakable = markerIdx === -1 ? fullContent : fullContent.slice(0, markerIdx);
        const tail = speakable.slice(spokenLen).trim();
        if (tail) onTextReady(tail + " ");
      }
      if (narrationDisplayRef.current) {
        // Voice turn: speech is still playing. Stash the full text and leave
        // the bubble streaming — the audio-end handler finalizes it so the
        // text never jumps ahead of the voice.
        fullTextRef.current = fullContent;
        textDoneRef.current = true;
      } else {
        if (tokenBufferRef.current) {
          const remaining = tokenBufferRef.current;
          tokenBufferRef.current = "";
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "tutor" && last.isStreaming) {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + remaining,
              };
            }
            return updated;
          });
        }
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "tutor" && last.isStreaming) {
            updated[updated.length - 1] = { ...last, isStreaming: false };
          }
          return updated;
        });
      }
    }

    return fullContent;
  }, []);

  const transcribeAudio = useCallback(async (blob: Blob): Promise<string> => {
    const form = new FormData();
    form.append("audio", blob);
    const res = await fetch("/api/agent/speech-to-text", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (
        data.detail?.includes?.("quota") ||
        data.detail?.status === "quota_exceeded"
      ) {
        throw new Error("QUOTA_EXCEEDED");
      }
      throw new Error("Transcription failed");
    }
    const data = await res.json();
    return data.text;
  }, []);

  // Appends a chunk to the SourceBuffer, queueing it if the buffer is still
  // processing a previous append (SourceBuffer forbids concurrent appends).
  const appendAudioChunk = useCallback((bytes: Uint8Array) => {
    const sb = sourceBufferRef.current;
    if (!sb || sb.updating || pendingAudioChunksRef.current.length > 0) {
      pendingAudioChunksRef.current.push(bytes);
      return;
    }
    try {
      sb.appendBuffer(bytes as BufferSource);
    } catch {
      // SourceBuffer in an unusable state — drop this chunk
    }
  }, []);

  const drainPendingAudio = useCallback(() => {
    const sb = sourceBufferRef.current;
    if (!sb || sb.updating) return;
    if (pendingAudioChunksRef.current.length > 0) {
      const next = pendingAudioChunksRef.current.shift()!;
      try {
        sb.appendBuffer(next as BufferSource);
      } catch {
        // ignore
      }
      return;
    }
    if (streamEndedRef.current) {
      try {
        mediaSourceRef.current?.endOfStream();
      } catch {
        // ignore — may already be closed
      }
    }
  }, []);

  /** Replace the in-flight tutor bubble's content (and optionally mark it done). */
  const setStreamingTutorContent = useCallback((content: string, done = false) => {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === "tutor" && last.isStreaming) {
        updated[updated.length - 1] = {
          ...last,
          content,
          ...(done ? { isStreaming: false } : null),
        };
      }
      return updated;
    });
  }, []);

  // Hands display control back from the alignment reveal to normal flow.
  // Called on audio end (normal finish), WS failure, or barge-in.
  const releaseNarrationDisplay = useCallback(() => {
    if (!narrationDisplayRef.current) return;
    narrationDisplayRef.current = false;
    cancelAnimationFrame(revealRafRef.current);
    if (textDoneRef.current) {
      // Generation already finished — show the full text and close the bubble.
      setStreamingTutorContent(fullTextRef.current, true);
    } else {
      // Generation still streaming — clear the partial spoken reveal; the
      // token flush loop rebuilds the bubble from the (never-flushed) buffer.
      setStreamingTutorContent("");
    }
  }, [setStreamingTutorContent]);

  // Reveals characters whose spoken timestamp has passed the playhead.
  const startRevealLoop = useCallback(() => {
    cancelAnimationFrame(revealRafRef.current);
    const tick = () => {
      if (!narrationDisplayRef.current) return;
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        const tMs = audio.currentTime * 1000;
        const times = alignTimesRef.current;
        let i = revealCursorRef.current;
        while (i < times.length && times[i] <= tMs) i++;
        if (i !== revealCursorRef.current) {
          revealCursorRef.current = i;
          setStreamingTutorContent(alignCharsRef.current.slice(0, i).join(""));
        }
      }
      revealRafRef.current = requestAnimationFrame(tick);
    };
    revealRafRef.current = requestAnimationFrame(tick);
  }, [setStreamingTutorContent]);

  // Opens a fresh WebSocket + MediaSource session for one mentor turn. Text
  // sent via sendNarrationText() before the socket is open gets buffered and
  // flushed once the connection + init handshake complete.
  const startNarrationSession = useCallback(async () => {
    // Claim the display synchronously — before any await — so LLM tokens
    // arriving during the token-fetch handshake stay buffered instead of
    // rendering ahead of speech.
    narrationDisplayRef.current = true;
    alignCharsRef.current = [];
    alignTimesRef.current = [];
    chunkOffsetMsRef.current = 0;
    revealCursorRef.current = 0;
    fullTextRef.current = "";
    textDoneRef.current = false;
    inputDoneRef.current = false;

    try {
      const tokenRes = await fetch("/api/agent/tts-token", { method: "POST" });
      if (!tokenRes.ok) {
        releaseNarrationDisplay();
        return;
      }
      const { token, voiceId } = (await tokenRes.json()) as { token: string; voiceId: string };

      streamEndedRef.current = false;
      pendingAudioChunksRef.current = [];
      pendingTextRef.current = "";

      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      sourceBufferRef.current = null;

      const url = URL.createObjectURL(mediaSource);
      const audio = new Audio(url);
      audioRef.current = audio;

      mediaSource.addEventListener("sourceopen", () => {
        if (mediaSourceRef.current !== mediaSource) return; // superseded
        try {
          const sb = mediaSource.addSourceBuffer("audio/mpeg");
          sourceBufferRef.current = sb;
          sb.addEventListener("updateend", drainPendingAudio);
        } catch {
          // MediaSource setup failed — this turn will play silently
        }
      }, { once: true });

      audio.addEventListener("playing", () => setIsSpeaking(true));
      audio.addEventListener("ended", () => {
        setIsSpeaking(false);
        disconnectAudio();
        releaseNarrationDisplay();
      });

      try { connectAudioElement(audio); } catch { /* optional */ }
      audio.play().catch(() => { /* no data yet, or blocked — harmless */ });
      startRevealLoop();

      const ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
        `?model_id=${TTS_MODEL_ID}&single_use_token=${encodeURIComponent(token)}`
      );
      wsRef.current = ws;
      wsOpenRef.current = false;

      ws.onopen = () => {
        if (wsRef.current !== ws) return; // superseded by a newer session
        ws.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true },
          generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
        }));
        wsOpenRef.current = true;
        if (pendingTextRef.current) {
          ws.send(JSON.stringify({ text: pendingTextRef.current }));
          pendingTextRef.current = "";
        }
        // Generation finished before the handshake did — close input now.
        if (inputDoneRef.current) {
          ws.send(JSON.stringify({ text: "" }));
        }
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const data = JSON.parse(event.data);
          if (data.audio) {
            appendAudioChunk(base64ToUint8Array(data.audio));
          }
          // Per-character timing for this chunk, relative to the chunk's
          // audio start — accumulate into absolute stream timestamps that
          // drive the on-screen reveal.
          const align = data.alignment;
          if (align?.chars?.length) {
            const { chars, charStartTimesMs, charDurationsMs } = align as {
              chars: string[];
              charStartTimesMs: number[];
              charDurationsMs: number[];
            };
            const offset = chunkOffsetMsRef.current;
            for (let i = 0; i < chars.length; i++) {
              alignCharsRef.current.push(chars[i]);
              alignTimesRef.current.push(offset + (charStartTimesMs[i] ?? 0));
            }
            const last = chars.length - 1;
            chunkOffsetMsRef.current =
              offset + (charStartTimesMs[last] ?? 0) + (charDurationsMs[last] ?? 0);
          }
          if (data.isFinal) {
            streamEndedRef.current = true;
            drainPendingAudio();
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onerror = () => { if (wsRef.current === ws) wsOpenRef.current = false; };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsOpenRef.current = false;
        // Abnormal close (no isFinal): audio won't reach "ended", so hand
        // the display back to normal flow here. A normal close still has
        // buffered audio playing — the "ended" handler finalizes then.
        if (!streamEndedRef.current) releaseNarrationDisplay();
      };
    } catch {
      // Narration session couldn't start — text response shows normally
      releaseNarrationDisplay();
    }
  }, [connectAudioElement, disconnectAudio, appendAudioChunk, drainPendingAudio, releaseNarrationDisplay, startRevealLoop]);

  // Sends text to the live narration session, sanitized for speech. Buffers
  // if the WebSocket handshake hasn't completed yet.
  const sendNarrationText = useCallback((text: string) => {
    const clean = sanitizeForTTS(text);
    if (!clean) return;
    const payload = clean.endsWith(" ") ? clean : clean + " ";
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && wsOpenRef.current) {
      wsRef.current.send(JSON.stringify({ text: payload }));
    } else {
      pendingTextRef.current += payload;
    }
  }, []);

  // Signals no more text is coming for this turn — ElevenLabs will flush
  // remaining audio and send a final isFinal message.
  const endNarrationInput = useCallback(() => {
    inputDoneRef.current = true;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text: "" }));
    } else if (!ws || ws.readyState !== WebSocket.CONNECTING) {
      // No session (or a dead one) — nothing will play; a CONNECTING socket
      // sends the terminator itself in onopen via inputDoneRef.
      streamEndedRef.current = true;
    }
  }, []);

  // Hard stop: tears down the socket, media source, and audio element.
  const stopNarration = useCallback(() => {
    pendingTextRef.current = "";
    pendingAudioChunksRef.current = [];
    streamEndedRef.current = true;

    // Finalize the interrupted bubble (full text if generation had finished)
    // before tearing the audio down.
    releaseNarrationDisplay();

    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    wsOpenRef.current = false;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;

    setIsSpeaking(false);
    disconnectAudio();
  }, [disconnectAudio, releaseNarrationDisplay]);

  const processVoiceInput = useCallback(
    async (audioBlob: Blob) => {
      setIsProcessing(true);
      try {
        const transcription = await transcribeAudio(audioBlob);
        if (!transcription.trim()) return;

        setMessages((prev) => [
          ...prev,
          { role: "user", content: transcription },
        ]);

        // Fire-and-forget: opens in parallel with generation starting, so we
        // don't add the token-fetch/handshake latency on top of it.
        startNarrationSession();
        await streamChat(transcription, sendNarrationText);
        endNarrationInput();
      } catch (err) {
        // Generation failed mid-turn — tear the narration session down so a
        // half-fed socket doesn't keep the display or audio hostage.
        stopNarration();
        if (err instanceof Error && err.message === "QUOTA_EXCEEDED") {
          setMessages((prev) => [
            ...prev,
            {
              role: "tutor",
              content:
                "Voice mode is currently unavailable. Switching to text mode to continue.",
            },
          ]);
          setMode("text");
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "tutor",
              content:
                "I'm having trouble connecting right now. Please try again in a moment.",
            },
          ]);
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [transcribeAudio, streamChat, startNarrationSession, sendNarrationText, endNarrationInput, stopNarration]
  );

  const startRecording = useCallback(async () => {
    // Barge-in: stop any in-progress narration so it doesn't talk over the
    // student while they record their voice input.
    stopNarration();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      try {
        connectAudioStream(stream);
      } catch {
        // Audio analyzer is optional
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        disconnectAudio();
        processVoiceInput(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "tutor",
          content:
            "Microphone access is required for voice mode. Please allow microphone access and try again.",
        },
      ]);
    }
  }, [processVoiceInput, connectAudioStream, disconnectAudio, stopNarration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isProcessing) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsProcessing(true);

      try {
        await streamChat(text);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "tutor",
            content:
              "I'm having trouble connecting right now. Please try again in a moment.",
          },
        ]);
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, streamChat]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setWhiteboardSteps([]);
    nextStepIdRef.current = 0;
  }, []);

  const toggleMode = useCallback(() => {
    stopNarration();
    if (isRecording) stopRecording();
    setMode((prev) => (prev === "text" ? "voice" : "text"));
  }, [isRecording, stopRecording, stopNarration]);

  return {
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
  };
}
