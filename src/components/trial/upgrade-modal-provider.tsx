"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  MCQ_PER_SECTION,
  PRICING_PATH,
  SAMPLE_TESTS,
  TBS_PER_SECTION,
  TRIAL_ENDED_PATH,
  TRIAL_ERROR_CODES,
  TUTOR_ENABLED_IN_TRIAL,
  TUTOR_MESSAGES_PER_DAY_TRIAL,
  type TrialItemKind,
} from "@/lib/trial";
import { useTrackEvent } from "@/hooks/use-track-event";

export type UpgradeReason = TrialItemKind | "locked" | "tutor_limit";

const COPY: Record<UpgradeReason, { title: string; message: string }> = {
  mcq: {
    title: "You've used your free questions",
    message: `Your free trial includes ${MCQ_PER_SECTION} questions per section. Subscribe for the full question bank — your progress is saved.`,
  },
  tbs: {
    title: "Sample simulation used",
    message: `Your free trial includes ${TBS_PER_SECTION} sample Task-Based Simulation per section. Subscribe to unlock them all.`,
  },
  sample_test: {
    title: "Sample practice test used",
    message: `Your free trial includes ${SAMPLE_TESTS} short sample practice test. Subscribe for full-length mock exams in every section.`,
  },
  tutor_limit: {
    title: "Daily AI tutor limit reached — unlimited in Pro",
    message: `Your free trial includes ${TUTOR_MESSAGES_PER_DAY_TRIAL} AI tutor messages a day. They reset at midnight UTC, or subscribe for unlimited tutoring — your chat history is saved.`,
  },
  locked: {
    title: "This is a Pro feature",
    message:
      `Full-length mock exams, ${TUTOR_ENABLED_IN_TRIAL ? "unlimited AI tutoring" : "the AI tutor"}, micro-lessons and other premium study materials are part of Athena Pro.`,
  },
};

type Ctx = { openUpgrade: (reason: UpgradeReason) => void };
const UpgradeModalContext = createContext<Ctx>({ openUpgrade: () => {} });

export function useUpgradeModal() {
  return useContext(UpgradeModalContext);
}

function isTrialKind(value: unknown): value is TrialItemKind {
  return value === "mcq" || value === "tbs" || value === "sample_test";
}

function isUpgradeReason(value: unknown): value is UpgradeReason {
  return isTrialKind(value) || value === "locked" || value === "tutor_limit";
}

/**
 * Maps a 402 response body to a modal reason. Returns "expired" for an ended
 * trial and null for anything that isn't a trial gate.
 */
export function upgradeReasonFromBody(body: unknown): UpgradeReason | "expired" | null {
  if (!body || typeof body !== "object") return null;
  const code = "code" in body ? body.code : null;
  if (code === TRIAL_ERROR_CODES.limit) {
    const kind = "kind" in body ? body.kind : null;
    return isTrialKind(kind) ? kind : "locked";
  }
  if (code === TRIAL_ERROR_CODES.tutorLimit) return "tutor_limit";
  if (code === TRIAL_ERROR_CODES.locked) return "locked";
  if (code === TRIAL_ERROR_CODES.expired) return "expired";
  return null;
}

/**
 * Redirect target for a page that bounced because of a trial gate. The target
 * page's provider opens the modal once from `?locked=<reason>`. Initial-load
 * 402s need this: child queries fire before the provider patches fetch.
 */
export function withLockedParam(path: string, reason: UpgradeReason | "expired" | null): string {
  if (reason === "expired") return TRIAL_ENDED_PATH;
  if (!reason) return path;
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}locked=${reason}${hash ? `#${hash}` : ""}`;
}

/** Opens the modal once when a page was bounced here from a locked page, then drops the param. */
function RedirectWatcher({ onOpen }: { onOpen: (reason: UpgradeReason) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const locked = params.get("locked");
  const upgrade = params.get("upgrade") === "true";
  useEffect(() => {
    if (!upgrade && !locked) return;
    onOpen(isUpgradeReason(locked) ? locked : "locked");
    const next = new URLSearchParams(params.toString());
    next.delete("locked");
    next.delete("upgrade");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`, { scroll: false });
  }, [upgrade, locked, onOpen, params, router, pathname]);
  return null;
}

/**
 * Global upgrade popup. Any same-origin `/api` call that answers 402 with a
 * trial code opens it (or sends an expired user to the pricing page), so
 * individual call sites don't need to handle trial limits themselves.
 */
export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [reason, setReason] = useState<UpgradeReason | null>(null);
  const queryClient = useQueryClient();
  const openUpgrade = useCallback((r: UpgradeReason) => setReason(r), []);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      if (res.status !== 402) return res;
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.origin
      );
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return res;

      const body: unknown = await res.clone().json().catch(() => null);
      const r = upgradeReasonFromBody(body);
      if (r === "expired") {
        window.location.assign(TRIAL_ENDED_PATH);
      } else if (r) {
        setReason(r);
        if (r !== "locked") queryClient.invalidateQueries({ queryKey: ["trial"] });
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [queryClient]);

  const trackEvent = useTrackEvent();
  useEffect(() => {
    if (reason) trackEvent({ name: "paywall_viewed", props: { surface: "modal", reason } });
  }, [reason, trackEvent]);

  const value = useMemo(() => ({ openUpgrade }), [openUpgrade]);
  const copy = reason ? COPY[reason] : null;

  return (
    <UpgradeModalContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <RedirectWatcher onOpen={openUpgrade} />
      </Suspense>
      <Dialog open={reason !== null} onOpenChange={(open) => !open && setReason(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center bg-primary/10">
              {reason === "locked" ? (
                <Lock className="h-5 w-5 text-primary" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary" />
              )}
            </div>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>{copy?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReason(null)}>
              Close
            </Button>
            <Button asChild onClick={() => setReason(null)}>
              <Link href={PRICING_PATH}>View Plans</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UpgradeModalContext.Provider>
  );
}
