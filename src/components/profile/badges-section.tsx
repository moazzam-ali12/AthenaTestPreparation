"use client";

import type { Badge } from "@/lib/badges";

export function BadgesSection({ badges }: { badges: Badge[] }) {
  const earned = badges.filter((b) => b.earned);

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Badges
        <span className="ml-2 text-foreground">{earned.length}/{badges.length}</span>
      </h3>
      <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-5">
        {badges.map((badge) => (
          <div
            key={badge.id}
            title={badge.earned ? badge.description : `Locked: ${badge.description}`}
            className={`flex flex-col items-center gap-1 ${
              badge.earned ? "opacity-100" : "opacity-25"
            }`}
          >
            <span className="text-2xl leading-none">{badge.emoji}</span>
            <span className="text-center text-[10px] font-medium leading-tight text-muted-foreground">
              {badge.name}
            </span>
          </div>
        ))}
      </div>
      {earned.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Complete quests to earn badges.
        </p>
      )}
    </div>
  );
}
