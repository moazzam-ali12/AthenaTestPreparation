"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpgradeModal } from "@/components/trial/upgrade-modal-provider";

/**
 * A link that, when `locked`, stays visible with a lock badge and opens the
 * upgrade modal instead of navigating — so trial users see what they're missing.
 */
export function LockedFeatureLink({
  locked,
  href,
  className,
  children,
}: {
  locked: boolean;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { openUpgrade } = useUpgradeModal();
  if (!locked) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openUpgrade("locked")}
      className={cn("relative w-full text-left", className)}
      aria-label="Pro feature — view plans"
    >
      {children}
      <span className="absolute left-3 top-3 flex items-center gap-1 bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Lock className="h-3 w-3" /> Pro
      </span>
    </button>
  );
}
