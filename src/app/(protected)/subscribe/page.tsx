"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, Zap, Check, ExternalLink, Flame, Star, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Suspense } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { PLANS, DEFAULT_PLAN, type PlanId } from "@/lib/plans";
import { hasProAccess } from "@/lib/subscription";
import { useTrackEvent } from "@/hooks/use-track-event";

const FEATURES = [
  "Unlimited practice quizzes across AUD, FAR, REG, BAR, ISC & TCP",
  "AI tutor — step-by-step guidance on every missed question",
  "AI mentor — motivation and study coaching",
  "Independent section practice exams, scored 0-99 with a 75 pass mark",
  "Personalized adaptive daily quests",
  "My Learning — generate lessons on any custom topic",
  "Pass/fail tracking for every section — core and discipline",
  "Streak tracking and gamified tier progression",
];

type ProgressSummary = { streak: number; totalXp: number; questionsAnswered: number };

/** What an expired user has built so far: a nudge that it's all still there. */
function SavedProgress() {
  const { data } = useQuery<ProgressSummary>({
    queryKey: ["profile"],
    queryFn: () =>
      fetch("/api/profile").then((r) => {
        if (!r.ok) throw new Error("Failed to load profile");
        return r.json();
      }),
    staleTime: 2 * 60_000,
  });
  if (!data) return null;
  const stats = [
    { icon: Flame, label: "day streak", value: data.streak ?? 0 },
    { icon: Star, label: "XP earned", value: data.totalXp ?? 0 },
    { icon: ListChecks, label: "questions answered", value: data.questionsAnswered ?? 0 },
  ];
  return (
    <div data-testid="saved-progress" className="mt-4 grid grid-cols-3 gap-2">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="border border-border bg-card px-3 py-2 text-center">
          <Icon className="mx-auto h-4 w-4 text-primary" />
          <p className="mt-1 text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

function SubscribePage() {
  const searchParams = useSearchParams();
  const success = searchParams.get("checkout") === "success";
  const trialEnded = searchParams.get("reason") === "trial_ended";
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [plan, setPlan] = useState<PlanId>(DEFAULT_PLAN);
  const { data: userData, refetch } = useCurrentUser();
  const selected = PLANS[plan];
  const annualSavings = PLANS.monthly.price * 12 - PLANS.annual.price;
  const isSubscribed = hasProAccess(userData?.user.subscriptionStatus);
  const trackEvent = useTrackEvent();
  const userLoaded = !!userData;

  // One paywall_viewed per visit, once we know the viewer isn't already subscribed.
  useEffect(() => {
    if (!userLoaded || isSubscribed || success) return;
    trackEvent({ name: "paywall_viewed", props: { surface: "subscribe", reason: trialEnded ? "trial_ended" : null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoaded]);

  // The webhook lands a moment after Stripe redirects back, so poll briefly
  // until the cached user flips to Pro.
  useEffect(() => {
    if (!success || isSubscribed) return;
    const interval = setInterval(() => refetch(), 2000);
    const timeout = setTimeout(() => clearInterval(interval), 20_000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [success, isSubscribed, refetch]);

  async function handleUpgrade() {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: null }));
        throw new Error(error ?? "Could not start checkout. Please try again.");
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      toast.error((err as Error).message || "Could not start checkout. Please try again.");
      setCheckoutLoading(false);
    }
  }

  async function handleManage() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      toast.error("Could not open billing portal. Please try again.");
      setPortalLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400"
        >
          🎉 Subscription activated! You now have full access to Athena, across every CPA section.
        </motion.div>
      )}

      {trialEnded && !isSubscribed && !success && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 border border-primary/30 bg-primary/5 p-4 text-sm"
        >
          <p>
            Your free trial has ended. Your progress is saved. Subscribe to continue where you left off
            — your streak picks up right where it stopped.
          </p>
          <SavedProgress />
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center bg-primary/10">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Athena Pro</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything you need to pass the CPA exam — one plan, no limits.
          </p>
        </div>

        {/* Plan card */}
        <div className="border border-primary/30 bg-card p-8">
          <div className="mb-6 grid grid-cols-2 border">
            {(Object.keys(PLANS) as PlanId[]).map((id) => (
              <button
                key={id}
                onClick={() => setPlan(id)}
                className={`py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  plan === id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {PLANS[id].label}
                {id === "annual" && annualSavings > 0 && ` · Save $${annualSavings}`}
              </button>
            ))}
          </div>

          <div className="mb-6 flex items-baseline gap-2">
            <span className="text-4xl font-bold">${selected.price}</span>
            <span className="text-sm text-muted-foreground">
              / {selected.interval}
            </span>
          </div>

          <ul className="mb-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={handleUpgrade}
            disabled={checkoutLoading || isSubscribed}
            className="flex w-full items-center justify-center gap-2 bg-primary py-3 text-sm font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Zap className="h-4 w-4" />
            {isSubscribed
              ? "You're subscribed"
              : checkoutLoading
                ? "Redirecting to Stripe…"
                : "Subscribe Now"}
          </button>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Secure payment via Stripe · Cancel anytime · Have a promo code? Enter it at checkout
          </p>
        </div>

        {/* Manage existing subscription — only shown when active */}
        {isSubscribed && (
          <div className="mt-6 border bg-card p-5">
            <p className="text-sm font-medium">Manage your subscription</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Update payment method, view invoices, or cancel anytime.
            </p>
            <button
              onClick={handleManage}
              disabled={portalLoading}
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {portalLoading ? "Opening portal…" : "Manage subscription"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default function SubscribePageWrapper() {
  return (
    <Suspense fallback={null}>
      <SubscribePage />
    </Suspense>
  );
}
