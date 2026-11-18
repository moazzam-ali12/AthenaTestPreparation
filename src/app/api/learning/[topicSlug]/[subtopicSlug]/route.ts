import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getSubtopicAccuracy } from "@/lib/db/queries/analytics";
import { getCurriculumLockMap } from "@/lib/db/queries/next-lesson";
import { selectQuizProblems } from "@/lib/adaptive/quiz-selection";
import { getFeatureTier } from "@/lib/subscription";
import { getConsumedItemIds } from "@/lib/db/queries/trial";
import { MCQ_PER_SECTION } from "@/lib/trial";
import { trialLimitResponse } from "@/lib/trial-gate";
import { isCpaSubject } from "@/types/cpa-exam";

export async function GET(
  req: Request,
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

  const [subtopicStats, { data: problemsData }, { count: attemptNumber }] = await Promise.all([
    getSubtopicAccuracy(user.id, subtopic.id),
    (supabase as any)
      .from("problems")
      .select("id, order_index, difficulty, difficulty_level, question_text, options, time_recommendation_seconds, concept_tags")
      .eq("source", "cpa")
      .eq("status", "approved")
      .eq("subtopic_id", subtopic.id)
      .order("order_index", { ascending: true }) as Promise<{ data: any[] | null }>,
    supabase
      .from("quiz_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("subtopic_id", subtopic.id),
  ]);
  const struggling = subtopicStats.totalAttempts >= 3 && subtopicStats.accuracy < 50;

  // 20 questions ramping easy -> hard, a fresh draw per attempt (the seed
  // changes once a quiz is submitted) but stable within one attempt.
  const quizProblems = selectQuizProblems(
    problemsData ?? [],
    `${user.id}:${subtopic.id}:${attemptNumber ?? 0}`
  );

  // Free trial: only `?mode=quiz` (the quiz itself) serves question content.
  // Nothing is consumed here — an MCQ counts against the per-section quota on
  // its first answer (POST /api/act-quiz/answer). The payload is capped to the
  // already-counted MCQs plus as many new ones as the section has left.
  const isTrial = getFeatureTier(user) !== "pro";
  const section = isCpaSubject(topic.subject) ? topic.subject : null;
  let servedProblems = quizProblems;
  // Trial quiz length shown on the overview card: what `?mode=quiz` would serve
  // (counted MCQs + remaining section quota), not the full Pro quiz length.
  let trialQuestionCount = quizProblems.length;
  if (isTrial) {
    const quizMode = new URL(req.url).searchParams.get("mode") === "quiz";
    if (!section) {
      servedProblems = [];
    } else {
      const counted = await getConsumedItemIds(user.id, "mcq", section);
      let newLeft = Math.max(MCQ_PER_SECTION - counted.size, 0);
      const allowed = quizProblems.filter((p) => {
        if (counted.has(p.id)) return true;
        if (newLeft === 0) return false;
        newLeft--;
        return true;
      });
      // Quota used up and this draw had no counted MCQs: re-serve the ones the
      // user already answered in this subtopic instead of an empty quiz.
      if (allowed.length === 0) {
        allowed.push(...(problemsData ?? []).filter((p) => counted.has(p.id)));
      }
      // Quota exhausted: keep the card's count; opening the quiz shows the upgrade modal.
      if (allowed.length > 0) trialQuestionCount = allowed.length;
      if (!quizMode) {
        servedProblems = [];
      } else {
        if (allowed.length === 0) return trialLimitResponse("mcq", section);
        servedProblems = allowed;
      }
    }
  }

  // No answer key, solution or hints while the quiz is in progress (all
  // tiers): they come back per question from POST /api/act-quiz/answer.
  const problems = servedProblems.map((p) => ({
    id: p.id,
    orderIndex: p.order_index,
    difficulty: p.difficulty,
    difficultyLevel: p.difficulty_level,
    questionText: p.question_text,
    options: p.options,
    timeRecommendationSeconds: p.time_recommendation_seconds,
    conceptTags: p.concept_tags ?? [],
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
    // Trial users see the quiz's question count without its content.
    questionCount: isTrial ? trialQuestionCount : problems.length,
    struggling,
  });
}
