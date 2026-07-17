import { getBadgeInputForUser, getEarnedBadgeIds, recordNewBadges } from "@/lib/db/queries/badges";
import { computeBadges, type Badge } from "@/lib/badges";
import { getRank, type Rank } from "@/lib/ranks";

export type RankUp = { from: Rank; to: Rank };

export type UnlockResult = {
  newBadges: Badge[];
  rankUp: RankUp | null;
};

/**
 * Diffs current badge/rank state against what's persisted and returns anything newly
 * earned since xpBefore. Badges are persisted so a fluctuating stat (e.g. accuracy)
 * dipping back below a threshold later doesn't re-trigger or revoke a celebration.
 * Rank-ups are stateless — XP only increases, so before/after in one request suffices.
 */
export async function checkNewUnlocks(
  userId: string,
  xpBefore: number,
  xpAfter: number
): Promise<UnlockResult> {
  const [badgeInput, earnedIds] = await Promise.all([
    getBadgeInputForUser(userId, xpAfter),
    getEarnedBadgeIds(userId),
  ]);

  const allBadges = computeBadges(badgeInput);
  const newlyEarned = allBadges.filter((b) => b.earned && !earnedIds.has(b.id));

  if (newlyEarned.length > 0) {
    await recordNewBadges(userId, newlyEarned.map((b) => b.id));
  }

  const rankBefore = getRank(xpBefore);
  const rankAfter = getRank(xpAfter);
  const rankUp = rankAfter.name !== rankBefore.name ? { from: rankBefore, to: rankAfter } : null;

  return { newBadges: newlyEarned, rankUp };
}
