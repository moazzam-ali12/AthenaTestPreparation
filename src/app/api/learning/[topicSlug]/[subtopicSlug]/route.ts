import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getSubtopicAccuracy } from "@/lib/db/queries/analytics";
import { getCurriculumLockMap } from "@/lib/db/queries/next-lesson";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicSlug: string; subtopicSlug: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { topicSlug, subtopicSlug } = await params;

  const { data: topic } = await supabase
    .from("topics")
    .select("id, slug, name, subject")
    .eq("slug", topicSlug)
    .limit(1)
    .maybeSingle();

  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }

  const { data: subtopic } = await supabase
    .from("subtopics")
    .select("*")
    .eq("topic_id", topic.id)
    .eq("slug", subtopicSlug)
    .limit(1)
    .maybeSingle();

  if (!subtopic) {
    return NextResponse.json({ error: "Subtopic not found" }, { status: 404 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const lockMap = await getCurriculumLockMap(user.id, user.targetDisciplineSection);
  if (lockMap.get(subtopic.id) ?? true) {
    return NextResponse.json(
      { error: "Complete the earlier subtopics in your curriculum first." },
      { status: 403 }
    );
  }

  const subtopicStats = await getSubtopicAccuracy(user.id, subtopic.id);
  const struggling = subtopicStats.totalAttempts >= 3 && subtopicStats.accuracy < 50;

  const { data: problemsData } = await (supabase as any)
    .from("problems")
    .select("id, order_index, difficulty, difficulty_level, question_text, options, correct_option, explanation, solution_steps, hint, detailed_hint, time_recommendation_seconds, concept_tags, option_hints")
    .eq("source", "cpa")
    .eq("subtopic_id", subtopic.id)
    .order("order_index", { ascending: true }) as { data: any[] | null };

  const problems = (problemsData ?? []).map((p) => ({
    id: p.id,
    orderIndex: p.order_index,
    difficulty: p.difficulty,
    difficultyLevel: p.difficulty_level,
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

  return NextResponse.json({
    topic: { slug: topic.slug, name: topic.name, subject: topic.subject ?? "english" },
    subtopic: {
      id: subtopic.id,
      slug: subtopic.slug,
      name: subtopic.name,
      description: subtopic.description,
      difficulty: subtopic.difficulty,
      estimatedMinutes: subtopic.estimated_minutes,
      learningObjectives: subtopic.learning_objectives,
      keyFormulas: subtopic.key_formulas,
      commonMistakes: subtopic.common_mistakes,
      tipsAndTricks: subtopic.tips_and_tricks,
      conceptualOverview: subtopic.conceptual_overview,
    },
    problems,
    struggling,
  });
}
