import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { parsePracticeIds } from "@/lib/tutor-modes";
import { gradePracticeAnswer, toPublicPracticeProblem, type PracticeRow } from "@/lib/practice-grading";

const COLUMNS =
  "id, order_index, difficulty, question_text, options, correct_option, explanation, solution_steps, hint, detailed_hint, time_recommendation_seconds, concept_tags, option_hints";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ topicSlug: string; subtopicSlug: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicSlug, subtopicSlug } = await params;
  const { searchParams } = new URL(req.url);
  const difficulty = searchParams.get("difficulty");
  // `?ids=` serves specific practice questions (the tutor's "Why was I wrong?" follow-ups).
  const ids = parsePracticeIds(searchParams.get("ids"));

  let query = (supabase as any)
    .from("problems")
    .select(COLUMNS)
    .eq("source", "practice")
    .eq("status", "approved")
    .eq("topic_slug", topicSlug)
    .eq("subtopic_slug", subtopicSlug);
  if (ids.length) query = query.in("id", ids);
  const { data } = (await query) as { data: PracticeRow[] | null };

  // Prefer the requested difficulty, then the nearest tiers, so a subtopic
  // missing that tier still returns practice instead of an empty set.
  const BAND_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const target = difficulty && difficulty in BAND_RANK ? BAND_RANK[difficulty] : null;
  const distance = (p: PracticeRow) =>
    target === null ? 0 : Math.abs((BAND_RANK[p.difficulty] ?? 1) - target);

  const shuffled = (data ?? [])
    .map((p) => ({ p, r: Math.random() }))
    .sort((a, b) => distance(a.p) - distance(b.p) || a.r - b.r)
    .map(({ p }) => p)
    .slice(0, 2);

  // No answer key, explanation or option hints until the candidate answers (POST).
  return NextResponse.json({ problems: shuffled.map(toPublicPracticeProblem) });
}

/**
 * Grade one practice answer. Returns the key only when correct or when the
 * client says the attempts are used up (`reveal`). Practice is ungraded for
 * progress: nothing here awards XP or skill.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ topicSlug: string; subtopicSlug: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { problemId?: unknown; selectedOption?: unknown; reveal?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { problemId, selectedOption, reveal } = body;
  if (typeof problemId !== "string" || typeof selectedOption !== "number" || !Number.isInteger(selectedOption)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { topicSlug, subtopicSlug } = await params;
  const { data } = (await (supabase as any)
    .from("problems")
    .select(COLUMNS)
    .eq("id", problemId)
    .eq("source", "practice")
    .eq("topic_slug", topicSlug)
    .eq("subtopic_slug", subtopicSlug)
    .maybeSingle()) as { data: PracticeRow | null };
  if (!data) return NextResponse.json({ error: "Problem not found" }, { status: 404 });

  return NextResponse.json(gradePracticeAnswer(data, selectedOption, reveal === true));
}
