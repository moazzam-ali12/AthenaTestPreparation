import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getSubsectionSkill } from "@/lib/db/queries/subsection-skills";
import { effectiveBand, isDifficultyBand, type DifficultyBand } from "@/lib/adaptive/engine";
import { getOverallLevel } from "@/lib/adaptive/overall-level";
import { supabase } from "@/lib/supabase/client";
import { isCpaSubject, type CpaSubject } from "@/types/cpa-exam";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

async function getSubjectForSubtopic(subtopicId: string): Promise<CpaSubject | null> {
  const { data } = await supabase
    .from("subtopics")
    .select("topics!inner(subject)")
    .eq("id", subtopicId)
    .maybeSingle();
  const subject = (data?.topics as unknown as { subject: string } | undefined)?.subject;
  return isCpaSubject(subject) ? subject : null;
}

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { topic, subtopic, subject, difficulty, subtopicId } = body as {
    topic: string;
    subtopic: string;
    subject?: string;
    difficulty?: string;
    subtopicId?: string;
  };

  if (!topic || !subtopic) {
    return NextResponse.json(
      { error: "Topic and subtopic are required" },
      { status: 400 }
    );
  }

  // The generator falls back to AUD for unknown subjects, so a missing or
  // non-CPA subject would silently produce questions for the wrong section.
  const resolvedSubject = isCpaSubject(subject)
    ? subject
    : subtopicId
      ? await getSubjectForSubtopic(subtopicId)
      : null;
  if (!resolvedSubject) {
    return NextResponse.json(
      { error: "A valid CPA section (aud, far, reg, bar, isc, tcp) is required" },
      { status: 400 }
    );
  }

  // Weakness targeting: an explicit difficulty wins; otherwise, when a
  // subtopicId is given, derive difficulty from the user's current skill level
  // so weaker areas get easier problems and stronger ones get harder ones.
  let targetDifficulty: DifficultyBand | undefined = isDifficultyBand(difficulty)
    ? difficulty
    : undefined;
  if (!targetDifficulty && subtopicId) {
    const user = await getUserByClerkId(clerkId);
    if (user) {
      const [skill, overallLevel] = await Promise.all([
        getSubsectionSkill(user.id, subtopicId),
        getOverallLevel(user.id),
      ]);
      targetDifficulty = effectiveBand(skill?.level ?? 1, overallLevel);
    }
  }

  try {
    const res = await fetch(`${AGENT_URL}/practice-problems`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        subtopic,
        subject: resolvedSubject,
        ...(targetDifficulty ? { difficulty: targetDifficulty } : {}),
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "no body");
      throw new Error(`Agent service returned ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/agent/practice-problems] Error:", err);
    return NextResponse.json(
      { error: "Failed to generate practice problems. Please try again." },
      { status: 503 }
    );
  }
}
