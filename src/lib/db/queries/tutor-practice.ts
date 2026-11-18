// Follow-up practice for the tutor's "Why was I wrong?" analysis.
import { supabase } from "@/lib/supabase/client";
import { practiceHref, practiceLabel, type PracticeLink } from "@/lib/tutor-modes";

type SlugRow = {
  topic_slug: string | null;
  subtopic_slug: string | null;
  subtopics: { slug: string; topics: { slug: string } | null } | null;
};

/** Up to `count` practice questions from the same subtopic as `problemId` (never the problem itself). */
export async function getFollowUpPracticeLinks(problemId: string, count = 2): Promise<PracticeLink[]> {
  const { data: problem } = (await (supabase as any)
    .from("problems")
    .select("topic_slug, subtopic_slug, subtopics(slug, topics(slug))")
    .eq("id", problemId)
    .maybeSingle()) as { data: SlugRow | null };
  if (!problem) return [];

  const topicSlug = problem.topic_slug ?? problem.subtopics?.topics?.slug;
  const subtopicSlug = problem.subtopic_slug ?? problem.subtopics?.slug;
  if (!topicSlug || !subtopicSlug) return [];

  const { data: rows } = (await (supabase as any)
    .from("problems")
    .select("id, question_text")
    .eq("source", "practice")
    .eq("status", "approved")
    .eq("topic_slug", topicSlug)
    .eq("subtopic_slug", subtopicSlug)
    .neq("id", problemId)
    .limit(20)) as { data: { id: string; question_text: string }[] | null };

  return (rows ?? [])
    .map((r) => ({ r, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, count)
    .map(({ r }) => ({
      id: r.id,
      label: practiceLabel(r.question_text),
      href: practiceHref(topicSlug, subtopicSlug, r.id),
    }));
}
