"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Send, Minimize2 } from "lucide-react";
import { useFloatingTutorPresence, type OrbPoint } from "@/hooks/use-floating-tutor-presence";
import { useTutorCharacter } from "@/components/providers/tutor-character-provider";
import { CharacterAvatar, TutorCharacterPopover } from "@/components/tutor/tutor-character-popover";
import { getTutorCharacter } from "@/lib/tutor-characters";
import { MathContent } from "@/components/quiz/math-content";

type Message = { role: "user" | "assistant"; content: string };

// Button is 60px — this margin keeps its top-left corner (which x/y
// position) comfortably inside the viewport instead of at its exact edge.
const FAB_MARGIN = 90;

export function FloatingAITutor() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  // Must start identical on server and client (no `window` branch here) or
  // React flags a hydration mismatch — the mount effect below corrects this
  // to the real corner immediately after, before the fade-in is visible.
  const [restAnchor, setRestAnchor] = useState<OrbPoint>({ x: 0, y: 0 });
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  const { characterId } = useTutorCharacter();
  const character = getTutorCharacter(characterId);

  // Recompute the resting corner on resize so the FAB stays anchored
  // bottom-right at any viewport size.
  useEffect(() => {
    const update = () =>
      setRestAnchor({
        x: window.innerWidth - FAB_MARGIN,
        y: window.innerHeight - FAB_MARGIN,
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Roaming only while closed — the open chat panel stays fixed in place.
  // cursorAttract is off: unlike a canvas-embedded orb, this FAB is a click
  // target sitting in an empty corner (never covering content), so fleeing
  // the cursor only makes it harder to click. Just the idle float remains.
  const presence = useFloatingTutorPresence({
    enabled: !open,
    restAnchor,
    cursorAttract: false,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Abort stream + reset minimized when panel closes
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setMinimized(false);
    }
  }, [open]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMinimized(false);

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: text,
          lessonTitle: "General CPA Exam Help",
          lessonContent: "",
        }),
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: "Sorry, I'm unavailable right now. Please try again.",
          };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const token = parsed.token ?? "";
            if (token) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: updated[updated.length - 1].content + token,
                };
                return updated;
              });
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 80)}px`;
  };

  return (
    <>
      {/* FAB — roams gently near the corner, avoiding the cursor, while closed */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ opacity: { duration: 0.2 }, scale: { type: "spring", stiffness: 400, damping: 25 } }}
            onClick={() => setOpen(true)}
            aria-label="Open AI Tutor"
            className="fixed top-0 left-0 z-50 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 transition-colors cursor-pointer"
            style={{ width: 60, height: 60, x: presence.x, y: presence.y }}
          >
            <motion.span
              className="absolute inset-0 rounded-full bg-primary"
              animate={{ scale: [1, 1.18, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            />
            {character.spritesheet ? (
              <span className="relative">
                <CharacterAvatar character={character} size={40} orbState={isStreaming ? "speaking" : "idle"} />
              </span>
            ) : (
              <Sparkles className="relative h-6 w-6" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl border bg-background shadow-2xl overflow-hidden"
            style={{ width: 360, height: minimized ? "auto" : 500 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-primary/5 shrink-0">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: [0, 15, -15, 0] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 4 }}
                >
                  <Sparkles className="h-4 w-4 text-primary" />
                </motion.div>
                <span className="font-semibold text-sm">Athena AI Tutor</span>
                {isStreaming && (
                  <span className="text-xs text-muted-foreground animate-pulse">thinking...</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  ref={pickerBtnRef}
                  onClick={() => {
                    setPickerAnchor(pickerBtnRef.current?.getBoundingClientRect() ?? null);
                    setPickerOpen((o) => !o);
                  }}
                  aria-label="Choose tutor character and voice"
                  className="rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <CharacterAvatar character={character} size={20} />
                </button>
                <button
                  onClick={() => setMinimized((m) => !m)}
                  aria-label="Minimize"
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {!minimized && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col flex-1 overflow-hidden"
                >
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                    {messages.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                        <div className="rounded-full bg-primary/10 p-3">
                          <Sparkles className="h-5 w-5 text-primary" />
                        </div>
                        <p className="text-sm font-medium">Hi, I&apos;m Athena!</p>
                        <p className="text-xs text-muted-foreground">
                          Ask me anything about AUD, FAR, REG, or your discipline section.
                        </p>
                      </div>
                    )}

                    {messages.map((m, i) => (
                      <div
                        key={i}
                        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                            m.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-muted text-foreground rounded-bl-sm"
                          }`}
                        >
                          {m.content ? (
                            m.role === "assistant" ? (
                              <MathContent content={m.content} />
                            ) : (
                              m.content
                            )
                          ) : (
                            <span className="flex gap-1 items-center h-4">
                              <motion.span
                                className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-60"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                              />
                              <motion.span
                                className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-60"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                              />
                              <motion.span
                                className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-60"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                              />
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={bottomRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t p-3 flex gap-2 items-end shrink-0">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleTextareaChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a question..."
                      rows={1}
                      className="flex-1 resize-none rounded-xl border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                      style={{ maxHeight: 80 }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!input.trim() || isStreaming}
                      aria-label="Send message"
                      className="flex items-center justify-center rounded-xl bg-primary text-primary-foreground p-2.5 disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <TutorCharacterPopover
        open={pickerOpen}
        anchorRect={pickerAnchor}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
