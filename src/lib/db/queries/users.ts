import { supabase } from "@/lib/supabase/client";
import type { CpaSection } from "@/types/cpa-exam";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUser(row: any) {
  return {
    id: row.id,
    clerkId: row.clerk_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    skillScore: row.skill_score,
    targetDisciplineSection: row.target_discipline_section as CpaSection | null,
    bestStreak: row.best_streak,
    onboardingCompleted: row.onboarding_completed,
    totalXp: row.total_xp,
    timezone: row.timezone,
    stripeCustomerId: row.stripe_customer_id as string | null,
    subscriptionStatus: (row.subscription_status ?? "free") as string,
    planType: (row.plan_type ?? "free") as string,
    subscriptionEndDate: row.subscription_end_date ? new Date(row.subscription_end_date) : null,
    questBlocked: (row.quest_blocked as boolean) ?? false,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getUserByClerkId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("clerk_id", clerkId)
    .limit(1)
    .single();

  return data ? mapUser(data) : null;
}

export async function createUser(data: {
  clerkId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}) {
  const { data: row } = await supabase
    .from("users")
    .upsert(
      {
        clerk_id: data.clerkId,
        email: data.email,
        display_name: data.displayName ?? null,
        avatar_url: data.avatarUrl ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    )
    .select()
    .single();

  return row ? mapUser(row) : null;
}

export async function updateUser(
  clerkId: string,
  data: Partial<{
    displayName: string;
    avatarUrl: string;
    skillScore: number;
    bestStreak: number;
    onboardingCompleted: boolean;
    totalXp: number;
    timezone: string;
    stripeCustomerId: string;
    subscriptionStatus: string;
    planType: string;
    subscriptionEndDate: Date | null;
    targetDisciplineSection: CpaSection;
  }>
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.displayName !== undefined) update.display_name = data.displayName;
  if (data.avatarUrl !== undefined) update.avatar_url = data.avatarUrl;
  if (data.skillScore !== undefined) update.skill_score = data.skillScore;
  if (data.bestStreak !== undefined) update.best_streak = data.bestStreak;
  if (data.onboardingCompleted !== undefined) update.onboarding_completed = data.onboardingCompleted;
  if (data.totalXp !== undefined) update.total_xp = data.totalXp;
  if (data.timezone !== undefined) update.timezone = data.timezone;
  if (data.stripeCustomerId !== undefined) update.stripe_customer_id = data.stripeCustomerId;
  if (data.subscriptionStatus !== undefined) update.subscription_status = data.subscriptionStatus;
  if (data.planType !== undefined) update.plan_type = data.planType;
  if (data.subscriptionEndDate !== undefined) update.subscription_end_date = data.subscriptionEndDate?.toISOString() ?? null;
  if (data.targetDisciplineSection !== undefined) update.target_discipline_section = data.targetDisciplineSection;

  const { data: row } = await supabase
    .from("users")
    .update(update)
    .eq("clerk_id", clerkId)
    .select()
    .single();

  return row ? mapUser(row) : null;
}
