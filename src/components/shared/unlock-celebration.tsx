"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfettiBurst } from "./confetti-burst";
import { useSound } from "@/hooks/useSound";
import type { Badge } from "@/lib/badges";
import type { RankUp } from "@/lib/gamification/check-unlocks";

type UnlockCelebrationProps = {
  newBadges: Badge[];
  rankUp: RankUp | null;
  onDismiss: () => void;
};

export function UnlockCelebration({ newBadges, rankUp, onDismiss }: UnlockCelebrationProps) {
  const sound = useSound();
  const hasUnlocks = newBadges.length > 0 || !!rankUp;

  useEffect(() => {
    if (!hasUnlocks) return;
    if (rankUp) sound.levelUp();
    else sound.achievement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnlocks]);

  if (!hasUnlocks) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="overflow-visible text-center sm:max-w-sm">
        <ConfettiBurst />
        <DialogHeader>
          <DialogTitle className="sr-only">Unlocked!</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {rankUp && (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="space-y-1"
            >
              <p className="text-5xl">{rankUp.to.emoji}</p>
              <p className="text-xs font-bold uppercase tracking-widest text-athena-amber">
                Rank Up!
              </p>
              <p className="text-lg font-bold">{rankUp.to.name}</p>
              <p className="text-xs text-muted-foreground">
                Unlocked the {rankUp.to.weapon}
              </p>
            </motion.div>
          )}
          {newBadges.map((badge, i) => (
            <motion.div
              key={badge.id}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 + i * 0.1 }}
              className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left"
            >
              <span className="text-3xl">{badge.emoji}</span>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-athena-amber">
                  New Badge!
                </p>
                <p className="text-sm font-semibold">{badge.name}</p>
                <p className="text-xs text-muted-foreground">{badge.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
