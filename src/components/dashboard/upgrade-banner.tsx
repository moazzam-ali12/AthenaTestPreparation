"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Sparkles, X, Zap } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAccess } from "@/hooks/use-trial";
import { hasProFeatures } from "@/lib/trial";

// Onboarding is free and /subscribe already shows the plans.
const HIDDEN_PREFIXES = ["/onboarding", "/subscribe"];

const PERKS = [
  "Unlimited practice quizzes across every section",
  "AI tutor & mentor access",
  "Independent section practice exams",
  "Personalized daily quests",
  "My Learning — custom topic generator",
];

function UpgradeBannerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const redirectedFromPaid = searchParams.get("upgrade") === "true";
  const { data: userData, loading } = useCurrentUser();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  // Real tier, not the feature tier: a full-mode trial still sees its countdown.
  const { accessTier: tier, daysLeft, graceDaysLeft } = useAccess();
  const isFree = !loading && !!userData && tier !== null && tier !== "pro";
  const onTrial = tier === "trial";
  // Full-mode trial: everything is unlocked, so no feature list — just the countdown.
  const fullTrial = onTrial && hasProFeatures(tier);
  const lastDay = daysLeft <= 1;
  const hiddenHere = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  // Being bounced off a paid page re-shows the banner even if it was dismissed.
  const visible = isFree && !hiddenHere && (redirectedFromPaid || !dismissed);

  function dismiss() {
    setDismissed(true);
    if (redirectedFromPaid) router.replace(pathname);
  }

  // Failed renewal, still inside the grace period: not dismissible, points at the portal.
  if (tier === "pro" && graceDaysLeft > 0) {
    return HIDDEN_PREFIXES.some((p) => pathname.startsWith(p)) || pathname.startsWith("/billing")
      ? null
      : <PaymentFailedBanner daysLeft={graceDaysLeft} />;
  }

  if (fullTrial) {
    return (
      <AnimatePresence>
        {visible && (
          <motion.div
            key="trial-banner"
            data-testid="trial-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="relative z-20 mx-auto max-w-6xl px-6 pt-6"
          >
            <div className="relative flex items-center gap-3 border border-primary/40 bg-primary/5 px-4 py-3 pr-10">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <p className="flex-1 min-w-0 text-sm font-medium">
                {lastDay
                  ? "Your free trial ends today — subscribe to keep your streak and progress."
                  : `Free trial — full access · ${daysLeft} days left`}
                {" · "}
                <Link href="/subscribe" className="font-semibold text-primary underline-offset-4 hover:underline">
                  View Plans
                </Link>
              </p>
              <button
                onClick={dismiss}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div key="upgrade-banner" exit={{ opacity: 0 }} className="relative z-20 mx-auto max-w-6xl px-6 pt-6">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="relative border border-primary/40 bg-primary/5 p-5"
        >
          {/* Dismiss */}
          <button
            onClick={dismiss}
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">
                {onTrial
                  ? daysLeft <= 1
                    ? "Free trial: last day · View Plans"
                    : `Free trial: ${daysLeft} days left · View Plans`
                  : "Unlock full CPA prep access"}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {redirectedFromPaid
                  ? "You need an active subscription to access this feature."
                  : onTrial
                    ? daysLeft <= 1
                      ? "Your free trial ends today. Subscribe to keep going — all your progress is saved."
                      : "You're exploring every CPA section with limited content. Subscribe to unlock everything."
                    : "Your free trial has ended. Your progress is saved — subscribe to continue where you left off."}
              </p>

              <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {PERKS.map((perk) => (
                  <li
                    key={perk}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Zap className="h-3 w-3 shrink-0 text-primary" />
                    {perk}
                  </li>
                ))}
              </ul>

              <Link
                href="/subscribe"
                className="mt-4 inline-flex items-center gap-2 bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                View Plans
              </Link>
            </div>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaymentFailedBanner({ daysLeft }: { daysLeft: number }) {
  const portal = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) throw new Error("Failed to open billing portal");
      return (await res.json()) as { url: string };
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: () => toast.error("Could not open billing portal. Please try again."),
  });

  return (
    <div data-testid="payment-failed-banner" className="relative z-20 mx-auto max-w-6xl px-6 pt-6">
      <div className="flex flex-wrap items-center gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <p className="flex-1 min-w-0 text-sm font-medium">
          Payment failed — update your card to keep access ({daysLeft} {daysLeft === 1 ? "day" : "days"} left)
        </p>
        <button
          onClick={() => portal.mutate()}
          disabled={portal.isPending || portal.isSuccess}
          className="bg-destructive px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {portal.isPending || portal.isSuccess ? "Opening…" : "Update card"}
        </button>
      </div>
    </div>
  );
}

export function UpgradeBanner() {
  return (
    <Suspense fallback={null}>
      <UpgradeBannerInner />
    </Suspense>
  );
}
