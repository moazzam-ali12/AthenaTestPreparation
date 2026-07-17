"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, Zap, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Suspense } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";

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

function SubscribePage() {
  const searchParams = useSearchParams();
  const success = searchParams.get("checkout") === "success";
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const { data: userData } = useCurrentUser();
  const isSubscribed =
    userData?.user.subscriptionStatus === "active" ||
    userData?.user.subscriptionStatus === "trialing";

  async function handleUpgrade() {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      toast.error("Could not start checkout. Please try again.");
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
          <div className="mb-6 flex items-baseline gap-2">
            <span className="text-4xl font-bold">$19</span>
            <span className="text-sm text-muted-foreground">/ month after your free trial</span>
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
            disabled={checkoutLoading}
            className="flex w-full items-center justify-center gap-2 bg-primary py-3 text-sm font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Zap className="h-4 w-4" />
            {checkoutLoading ? "Redirecting to Stripe…" : "Start Your 7-Day Free Trial"}
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
