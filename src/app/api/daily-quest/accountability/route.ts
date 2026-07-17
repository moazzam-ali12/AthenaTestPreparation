import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { supabase } from "@/lib/supabase/client";
import { NextResponse } from "next/server";

// GET — check if user is blocked (has missed quest needing reset)
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Mark any unresolved missed quests (quest_date < today, status != completed, not already marked)
  const today = new Date().toISOString().split("T")[0];

  const { data: missedQuests } = await supabase
    .from("daily_quests")
    .select("id, quest_date, status, reset_required, reset_completed_at")
    .eq("user_id", user.id)
    .lt("quest_date", today)
    .neq("status", "completed")
    .is("reset_completed_at", null);

  let isBlocked = false;
  let missedQuestId: string | null = null;
  let missedDate: string | null = null;

  if (missedQuests && missedQuests.length > 0) {
    const oldest = missedQuests[0];
    missedQuestId = oldest.id;
    missedDate = oldest.quest_date;

    // Mark as missed + reset_required if not already
    if (!oldest.reset_required) {
      await supabase
        .from("daily_quests")
        .update({ missed_at: new Date().toISOString(), reset_required: true })
        .eq("id", oldest.id);
    }

    // Block the user
    if (!user.questBlocked) {
      await supabase
        .from("users")
        .update({ quest_blocked: true, last_missed_quest_date: oldest.quest_date })
        .eq("id", user.id);
    }

    isBlocked = true;
  }

  return NextResponse.json({ isBlocked, missedQuestId, missedDate });
}

// POST — submit reset (recommit flow)
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let body: { questId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { questId, reason } = body;
  if (!questId || !reason) {
    return NextResponse.json({ error: "questId and reason are required" }, { status: 400 });
  }

  // Mark quest as reset
  await supabase
    .from("daily_quests")
    .update({
      reset_completed_at: new Date().toISOString(),
      reset_reason: reason,
    })
    .eq("id", questId)
    .eq("user_id", user.id);

  // Unblock user
  await supabase
    .from("users")
    .update({ quest_blocked: false })
    .eq("id", user.id);

  return NextResponse.json({ success: true });
}
