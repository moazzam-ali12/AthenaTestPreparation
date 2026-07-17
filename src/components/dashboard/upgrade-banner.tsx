"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Zap } from "lucide-react";
import Link from "next/link";

const PERKS = [
  "Unlimited practice quizzes across every section",
  "AI tutor & mentor access",
  "Independent section practice exams",
  "Personalized daily quests",
  "My Learning — custom topic generator",
];

function UpgradeBannerInner() {
  const searchParams = useSearchParams();
  const showUpgrade = searchParams.get("upgrade") === "true";
  const [dismissed, setDismissed] = useState(false);

  const visible = showUpgrade && !dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.3 }}
          className="relative border border-primary/40 bg-primary/5 p-5"
        >
          {/* Dismiss */}
          <button
            onClick={() => setDismissed(true)}
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
                Unlock full CPA prep access
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You need an active subscription to access this feature.
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
      )}
    </AnimatePresence>
  );
}

export function UpgradeBanner() {
  return (
    <Suspense fallback={null}>
      <UpgradeBannerInner />
    </Suspense>
  );
}
