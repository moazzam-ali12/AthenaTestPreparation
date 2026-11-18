import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getLearningSummary, type LearningSummary } from "@/lib/db/queries/analytics";
import { supabase } from "@/lib/supabase/client";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// learning_summaries isn't in the generated Supabase types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// A stable fingerprint of the facts the narrative is derived from. When these
// don't change, the cached narrative still describes the learner accurately, so
// we skip the LLM call.
function summaryInputHash(s: LearningSummary): string {
  const key = JSON.stringify({
    overallAccuracy: s.overallAccuracy,
    trend: s.trend,
    subtopicsAttempted: s.subtopicsAttempted,
    focusArea: s.focusArea
      ? [s.focusArea.subtopicName, s.focusArea.accuracy, s.focusArea.recommendation]
      : null,
    strength: s.strength ? [s.strength.subtopicName, s.strength.accuracy] : null,
  });
  return createHash("sha256").update(key).digest("hex");
}

async function synthesizeNarrative(
  s: LearningSummary
): Promise<{ headline: string; narrative: string[] } | null> {
  try {
    const res = await fetch(`${AGENT_URL}/learning-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        overall_accuracy: s.overallAccuracy,
        trend: s.trend,
        subtopics_attempted: s.subtopicsAttempted,
        focus_area: s.focusArea
          ? {
              subtopic_name: s.focusArea.subtopicName,
              accuracy: s.focusArea.accuracy,
              recommendation: s.focusArea.recommendation,
            }
          : null,
        strength: s.strength
          ? { subtopic_name: s.strength.subtopicName, accuracy: s.strength.accuracy }
          : null,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { headline?: string; narrative?: string[] };
    if (typeof data.headline !== "string" || !Array.isArray(data.narrative)) return null;
    return { headline: data.headline, narrative: data.narrative.map(String) };
  } catch {
    return null;
  }
}

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Deterministic summary always computed first — it's the source of the
  // structured fields (focusArea/strength/trend) and the guaranteed fallback.
  const summary = await getLearningSummary(user.id);

  // Not enough data yet: keep the template baseline, no LLM call.
  if (summary.subtopicsAttempted === 0) {
    return NextResponse.json(summary);
  }

  const inputHash = summaryInputHash(summary);

  // 1. Serve a fresh cached narrative if the stats haven't changed.
  const { data: cached } = await db
    .from("learning_summaries")
    .select("input_hash, headline, narrative, generated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const cacheFresh =
    cached &&
    cached.input_hash === inputHash &&
    Date.now() - new Date(cached.generated_at).getTime() < CACHE_TTL_MS;

  if (cacheFresh) {
    return NextResponse.json({
      ...summary,
      headline: cached.headline,
      narrative: cached.narrative as string[],
    });
  }

  // 2. Otherwise synthesize a fresh narrative. On any failure, fall back to the
  // deterministic summary so the page always renders.
  const llm = await synthesizeNarrative(summary);
  if (!llm) {
    return NextResponse.json(summary);
  }

  await db.from("learning_summaries").upsert(
    {
      user_id: user.id,
      input_hash: inputHash,
      headline: llm.headline,
      narrative: llm.narrative,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  return NextResponse.json({ ...summary, headline: llm.headline, narrative: llm.narrative });
}
