import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId, updateUser } from "@/lib/db/queries/users";
import { getProfileData } from "@/lib/db/queries/profile";
import { getLocalDateString } from "@/lib/db/queries/daily-quest";
import { getAllSectionProgress } from "@/lib/db/queries/cpa-exam";
import { buildBadgeInput } from "@/lib/db/queries/badges";
import { getRankProgress, RANKS } from "@/lib/ranks";
import { computeBadges } from "@/lib/badges";
import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";

const DAY_ABBREVS = ["S", "M", "T", "W", "T", "F", "S"];

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [profileData, sectionProgress] = await Promise.all([
    getProfileData(user.id),
    getAllSectionProgress(user.id),
  ]);

  const rankProgress = getRankProgress(user.totalXp ?? 0);

  // Weekly streak days — based on daily quests
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfWeekStr = getLocalDateString(startOfWeek);
  const today = getLocalDateString();

  const { data: weekQuestsData } = await supabase
    .from("daily_quests")
    .select("quest_date")
    .eq("user_id", user.id)
    .eq("status", "completed")
    .gte("quest_date", startOfWeekStr)
    .lte("quest_date", today);

  const completedDates = new Set(
    (weekQuestsData ?? []).map((q: { quest_date: string }) => q.quest_date)
  );

  const weeklyStreakDays = DAY_ABBREVS.map((abbrev, idx) => {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(startOfWeek.getDate() + idx);
    const dateStr = getLocalDateString(dayDate);
    const completed = completedDates.has(dateStr);
    const isPast = dateStr < today && !completed;
    return { day: abbrev, completed, isPast };
  });

  const badges = computeBadges(buildBadgeInput(profileData, sectionProgress, user.totalXp ?? 0));

  return NextResponse.json({
    ...profileData,
    totalXp: user.totalXp ?? 0,
    sectionProgress,
    weeklyStreakDays,
    badges,
    rank: {
      current: {
        name: rankProgress.current.name,
        weapon: rankProgress.current.weapon,
        emoji: rankProgress.current.emoji,
        threshold: rankProgress.current.threshold,
      },
      next: rankProgress.next
        ? {
            name: rankProgress.next.name,
            weapon: rankProgress.next.weapon,
            emoji: rankProgress.next.emoji,
            threshold: rankProgress.next.threshold,
          }
        : null,
      pct: rankProgress.pct,
      pointsToNext: rankProgress.pointsToNext,
    },
    tiers: RANKS.map((r) => ({
      name: r.name,
      threshold: r.threshold,
      weapon: r.weapon,
      emoji: r.emoji,
      active: (user.totalXp ?? 0) >= r.threshold,
    })),
  });
}

export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const displayName = typeof body.displayName === "string"
    ? body.displayName.trim()
    : null;

  if (!displayName || displayName.length === 0 || displayName.length > 50) {
    return NextResponse.json(
      { error: "Display name must be 1-50 characters" },
      { status: 400 }
    );
  }

  const updated = await updateUser(clerkId, { displayName });
  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ displayName: updated.displayName });
}
