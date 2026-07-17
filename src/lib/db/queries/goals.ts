import { supabase } from "@/lib/supabase/client";
import { getLocalDateString, getCurrentQuestStreak } from "@/lib/db/queries/daily-quest";
import { getProfileData } from "@/lib/db/queries/profile";

export type GoalType = "weekly_xp" | "accuracy_target" | "streak_days";

export type Goal = {
  goalType: GoalType;
  targetValue: number;
  currentValue: number;
};

const db = supabase as any;

async function getWeeklyXp(userId: string): Promise<number> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfWeekStr = getLocalDateString(startOfWeek);
  const today = getLocalDateString();

  const { data } = await db
    .from("daily_quests")
    .select("xp_earned")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("quest_date", startOfWeekStr)
    .lte("quest_date", today);

  return ((data ?? []) as { xp_earned: number }[]).reduce((sum, q) => sum + (q.xp_earned ?? 0), 0);
}

async function getCurrentValue(userId: string, goalType: GoalType): Promise<number> {
  if (goalType === "weekly_xp") return getWeeklyXp(userId);
  if (goalType === "streak_days") return getCurrentQuestStreak(userId);
  const profileData = await getProfileData(userId);
  return profileData.accuracy;
}

export async function getGoals(userId: string): Promise<Goal[]> {
  const { data } = await db
    .from("user_goals")
    .select("goal_type, target_value")
    .eq("user_id", userId);

  const rows = (data ?? []) as { goal_type: GoalType; target_value: number }[];

  return Promise.all(
    rows.map(async (r) => ({
      goalType: r.goal_type,
      targetValue: r.target_value,
      currentValue: await getCurrentValue(userId, r.goal_type),
    }))
  );
}

export async function upsertGoal(userId: string, goalType: GoalType, targetValue: number) {
  await db
    .from("user_goals")
    .upsert(
      { user_id: userId, goal_type: goalType, target_value: targetValue, updated_at: new Date().toISOString() },
      { onConflict: "user_id,goal_type" }
    );
}
