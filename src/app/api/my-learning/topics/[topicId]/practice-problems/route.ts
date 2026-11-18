import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { gradePracticeAnswer, toPublicPracticeProblem, type PracticeRow } from "@/lib/practice-grading";

const COLUMNS =
  "id, order_index, difficulty, question_text, options, correct_option, explanation, solution_steps, hint, detailed_hint, time_recommendation_seconds, concept_tags, option_hints";

/** The user's own custom topic, or null (owner check for both GET and POST). */
async function ownTopicId(topicId: string): Promise<string | null | NextResponse> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const { data } = await supabase
    .from("custom_topics")
    .select("id")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Practice for a custom topic: the questions already generated for it
 * (problems, source='custom'). My Learning is a general "learn anything"
 * feature, so this does NOT go through the CPA /practice-problems generator,
 * and nothing is generated on GET.
 *
 * No key, explanation, steps or hints before answering — POST grades each
 * answer (same contract as the CPA practice route the practice card uses).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ topicId: string }> }) {
  const owned = await ownTopicId((await params).topicId);
  if (owned instanceof NextResponse) return owned;
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data } = (await (supabase as any)
    .from("problems")
    .select(COLUMNS)
    .eq("source", "custom")
    .eq("custom_topic_id", owned)
    .order("order_index", { ascending: true })) as { data: PracticeRow[] | null };

  // Hints are withheld too; a miss gets one back from POST.
  const problems = (data ?? []).map((p) => ({ ...toPublicPracticeProblem(p), hint: "", detailedHint: undefined }));
  return NextResponse.json({ problems });
}

/** Grade one practice answer; the key comes back only when correct or on the final miss (`reveal`). */
export async function POST(req: Request, { params }: { params: Promise<{ topicId: string }> }) {
  const owned = await ownTopicId((await params).topicId);
  if (owned instanceof NextResponse) return owned;
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { problemId?: unknown; selectedOption?: unknown; reveal?: unknown }
    | null;
  const { problemId, selectedOption, reveal } = body ?? {};
  if (typeof problemId !== "string" || typeof selectedOption !== "number" || !Number.isInteger(selectedOption)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data } = (await (supabase as any)
    .from("problems")
    .select(COLUMNS)
    .eq("id", problemId)
    .eq("source", "custom")
    .eq("custom_topic_id", owned)
    .maybeSingle()) as { data: PracticeRow | null };
  if (!data) return NextResponse.json({ error: "Problem not found" }, { status: 404 });

  const grade = gradePracticeAnswer(data, selectedOption, reveal === true);
  // Custom questions have no per-option hints: after a miss, send the generic
  // hint in the same slot (the card titles it "Think about it:" as before).
  if (!grade.isCorrect && !grade.optionHint && data.hint) {
    grade.optionHint = { optionIndex: selectedOption, misconception: "Think about it:", hint: data.hint };
  }
  return NextResponse.json(grade);
}
