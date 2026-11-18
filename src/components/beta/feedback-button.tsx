"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TYPES = [
  { value: "bug", label: "🐞 Bug" },
  { value: "confusing", label: "😕 Confusing" },
  { value: "idea", label: "💡 Idea" },
] as const;
type FeedbackType = (typeof TYPES)[number]["value"];

// No button on timed exam / TBS screens (distracting, and the exam UI is full-screen).
const HIDDEN_ON = [/^\/practice-exam\/[^/]+/, /\/tbs(\/|$)/];

/** Sentry's last captured event on this page, if the Sentry SDK is loaded. */
function sentryEventId(): string | undefined {
  const s = (window as unknown as { Sentry?: { lastEventId?: () => string | undefined } }).Sentry;
  try {
    return s?.lastEventId?.() || undefined;
  } catch {
    return undefined;
  }
}

export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set("type", type);
      form.set("message", message);
      form.set("pageUrl", window.location.pathname + window.location.search);
      const sentryId = sentryEventId();
      if (sentryId) form.set("sentryEventId", sentryId);
      if (screenshot) form.set("screenshot", screenshot);
      const res = await fetch("/api/feedback", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not send feedback");
      }
    },
    onSuccess: () => {
      toast.success("Thanks! Your feedback was sent.");
      setOpen(false);
      setMessage("");
      setScreenshot(null);
      setType("bug");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="feedback-button"
        aria-label="Send feedback"
        className="fixed left-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-1.5 border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur hover:bg-muted md:bottom-4 md:left-4"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        Feedback
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Found a bug or something confusing? Tell us — we read every message. The page you&apos;re on and
              your browser are attached automatically.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (message.trim()) submit.mutate();
            }}
          >
            <div role="radiogroup" aria-label="Feedback type" className="flex gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  data-testid={`feedback-type-${t.value}`}
                  onClick={() => setType(t.value)}
                  className={`flex-1 border px-2 py-1.5 text-sm ${
                    type === t.value ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <textarea
              required
              maxLength={5000}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened? What did you expect?"
              data-testid="feedback-message"
              className="w-full resize-y border bg-background p-2 text-sm"
            />

            <label className="block text-sm">
              <span className="text-muted-foreground">Screenshot (optional, max 3 MB)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                data-testid="feedback-screenshot"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 3 * 1024 * 1024) {
                    toast.error("Screenshot must be 3 MB or smaller");
                    e.target.value = "";
                    return;
                  }
                  setScreenshot(f);
                }}
                className="mt-1 block w-full text-sm"
              />
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!message.trim() || submit.isPending} data-testid="feedback-submit">
                {submit.isPending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
