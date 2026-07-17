"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Zap, Check, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import Link from "next/link";
import { NotificationToggle } from "@/components/settings/notification-toggle";

const PRO_FEATURES = [
  "Unlimited practice quizzes across AUD, FAR, REG, BAR, ISC & TCP",
  "AI tutor on every missed question",
  "AI mentor & study coaching",
  "Independent section practice exams, scored 0-99",
  "Personalized daily quests",
  "My Learning — custom topic generator",
  "Pass/fail tracking across every section",
  "Streak tracking & tier progression",
];

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active" || status === "trialing";
  const isPastDue = status === "past_due";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
        isActive
          ? "bg-green-500/10 text-green-400 border border-green-500/30"
          : isPastDue
            ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
            : "bg-muted text-muted-foreground border border-border"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-green-400" : isPastDue ? "bg-yellow-400" : "bg-muted-foreground"}`}
      />
      {isActive ? "Active" : isPastDue ? "Past Due" : status === "canceled" ? "Canceled" : "Free"}
    </span>
  );
}

export default function BillingPage() {
  const { data: userData, loading } = useCurrentUser();
  const [portalLoading, setPortalLoading] = useState(false);

  const user = userData?.user;
  const isSubscribed =
    user?.subscriptionStatus === "active" ||
    user?.subscriptionStatus === "trialing";

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

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse" />
        <div className="h-32 bg-muted animate-pulse" />
        <div className="h-64 bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="space-y-6"
      >
        {/* Page header */}
        <motion.div variants={staggerItem}>
          <div className="flex items-center gap-3 mb-1">
            <CreditCard className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold tracking-tight">Billing & Plan</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Manage your Athena Pro subscription and notification preferences
            as you prepare for the CPA exam.
          </p>
        </motion.div>

        {/* Plan status card */}
        <motion.div variants={staggerItem} className="border bg-card p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Current Plan
              </p>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold">
                  {isSubscribed ? "Athena Pro" : "Free"}
                </span>
                <StatusBadge status={user?.subscriptionStatus ?? "free"} />
              </div>
              {isSubscribed && user?.subscriptionEndDate && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Renews{" "}
                  {new Date(user.subscriptionEndDate).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>

            {isSubscribed ? (
              <button
                onClick={handleManage}
                disabled={portalLoading}
                className="flex items-center gap-1.5 border px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-accent disabled:opacity-60"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {portalLoading ? "Opening…" : "Manage Billing"}
              </button>
            ) : (
              <Link
                href="/subscribe"
                className="flex items-center gap-1.5 bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Zap className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Link>
            )}
          </div>

          {user?.subscriptionStatus === "past_due" && (
            <div className="mt-4 flex items-start gap-2 border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Your last payment failed. Please{" "}
                <button
                  onClick={handleManage}
                  className="underline underline-offset-2"
                >
                  update your payment method
                </button>{" "}
                to keep access.
              </span>
            </div>
          )}
        </motion.div>

        {/* What's included */}
        <motion.div variants={staggerItem} className="border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            {isSubscribed ? "Your plan includes" : "Pro plan includes"}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <Check
                  className={`mt-0.5 h-4 w-4 shrink-0 ${isSubscribed ? "text-primary" : "text-muted-foreground/40"}`}
                />
                <span className={isSubscribed ? "" : "text-muted-foreground"}>
                  {f}
                </span>
              </li>
            ))}
          </ul>

          {!isSubscribed && (
            <div className="mt-6 border-t pt-5">
              <p className="text-sm font-medium mb-0.5">
                Unlock full access for{" "}
                <span className="font-bold text-primary">$19/month</span>
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Secure payment via Stripe · Cancel anytime
              </p>
              <Link
                href="/subscribe"
                className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Zap className="h-3.5 w-3.5" />
                Get Athena Pro
              </Link>
            </div>
          )}
        </motion.div>

        {/* Notification preferences */}
        <motion.div variants={staggerItem} className="border bg-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Notifications
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Get push notifications for study reminders and streak alerts.
          </p>
          <NotificationToggle />
        </motion.div>

        {/* Help */}
        <motion.div variants={staggerItem}>
          <p className="text-xs text-muted-foreground">
            Questions about billing?{" "}
            <a
              href="mailto:support@athena.app"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Contact support
            </a>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
