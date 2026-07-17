import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ topicSlug: string; subtopicSlug: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicSlug, subtopicSlug } = await params;
  const { searchParams } = new URL(req.url);
  const difficulty = searchParams.get("difficulty");

  let query = (supabase as any)
    .from("problems")
    .select("id, order_index, difficulty, question_text, options, correct_option, explanation, solution_steps, hint, detailed_hint, time_recommendation_seconds, concept_tags, option_hints")
    .eq("source", "practice")
    .eq("topic_slug", topicSlug)
    .eq("subtopic_slug", subtopicSlug);

  if (difficulty) {
    query = query.eq("difficulty", difficulty);
  }

  const { data } = (await query) as { data: any[] | null };

  // Shuffle in JS and return 2
  const shuffled = (data ?? []).sort(() => Math.random() - 0.5).slice(0, 2);

  const rows = shuffled.map((p) => ({
    id: p.id,
    orderIndex: p.order_index,
    difficulty: p.difficulty,
    questionText: p.question_text,
    options: p.options,
    correctOption: p.correct_option,
    explanation: p.explanation,
    solutionSteps: p.solution_steps,
    hint: p.hint,
    detailedHint: p.detailed_hint ?? undefined,
    timeRecommendationSeconds: p.time_recommendation_seconds,
    conceptTags: p.concept_tags ?? [],
    optionHints: p.option_hints ?? [],
  }));

  return NextResponse.json({ problems: rows });
}
