import { supabase } from "@/lib/supabase/client";
import { SUBTOPIC_PASS_THRESHOLD } from "@/lib/cpa-scoring";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import type { CpaSection } from "@/types/cpa-exam";

export type NextLessonResult =
  | {
      complete: false;
      topicSlug: string;
      topicName: string;
      subtopicSlug: string;
      subtopicName: string;
      subject: string;
      difficulty: string | null;
      estimatedMinutes: number | null;
      attempted: boolean;
      bestScorePct: number | null;
      passedCount: number;
      totalCount: number;
    }
  | {
      complete: true;
      passedCount: number;
      totalCount: number;
    };

type OrderedSubtopic = {
  id: string;
  topic_id: string;
  slug: string;
  name: string;
  difficulty: string | null;
  estimated_minutes: number | null;
  order_index: number;
};

/**
 * Fetches the user's relevant curriculum (3 core CPA sections + chosen discipline)
 * flattened into a single ordered sequence: section (in a fixed priority) → topic
 * order_index → subtopic order_index. order_index is scoped per subject (each
 * section's topics restart at 1), so section must be the primary sort key —
 * otherwise sections interleave arbitrarily.
 */
async function getOrderedCurriculum(userId: string, targetDisciplineSection: CpaSection | null) {
  const relevantSubjects = [
    ...CPA_CORE_SECTIONS.map((s) => s.toLowerCase()),
    ...(targetDisciplineSection ? [targetDisciplineSection.toLowerCase()] : []),
  ];
  const sectionPriority = new Map(relevantSubjects.map((s, i) => [s, i]));

  const { data: topicsData } = await supabase
    .from("topics")
    .select("id, slug, name, subject, order_index")
    .in("subject", relevantSubjects)
    .order("order_index", { ascending: true });

  const topics = topicsData ?? [];
  const topicIds = topics.map((t) => t.id);
  const topicMap = new Map(topics.map((t) => [t.id, t]));

  if (topicIds.length === 0) {
    return { subtopics: [] as OrderedSubtopic[], topicMap, bestScoreMap: new Map<string, number>() };
  }

  const { data: subtopicsData } = await supabase
    .from("subtopics")
    .select("id, topic_id, slug, name, difficulty, estimated_minutes, order_index")
    .in("topic_id", topicIds);

  const subtopics = (subtopicsData ?? []).sort((a, b) => {
    const topicA = topicMap.get(a.topic_id)!;
    const topicB = topicMap.get(b.topic_id)!;
    const sectionA = sectionPriority.get(topicA.subject) ?? 0;
    const sectionB = sectionPriority.get(topicB.subject) ?? 0;
    if (sectionA !== sectionB) return sectionA - sectionB;
    if (topicA.order_index !== topicB.order_index) return topicA.order_index - topicB.order_index;
    return a.order_index - b.order_index;
  });

  const subtopicIds = subtopics.map((s) => s.id);

  const { data: sessions } =
    subtopicIds.length > 0
      ? await supabase
          .from("quiz_sessions")
          .select("subtopic_id, score, total_questions")
          .eq("user_id", userId)
          .eq("source", "cpa")
          .in("subtopic_id", subtopicIds)
      : { data: [] as { subtopic_id: string | null; score: number; total_questions: number }[] };

  const bestScoreMap = new Map<string, number>();
  for (const s of sessions ?? []) {
    if (!s.subtopic_id || !s.total_questions) continue;
    const pct = s.score / s.total_questions;
    const existing = bestScoreMap.get(s.subtopic_id) ?? 0;
    if (pct > existing) bestScoreMap.set(s.subtopic_id, pct);
  }

  return { subtopics, topicMap, bestScoreMap };
}

/**
 * Returns the earliest subtopic in the user's relevant curriculum they haven't
 * yet passed. Derived entirely from quiz_sessions history — no stored pointer,
 * so passing/failing is reflected immediately on next read.
 */
export async function getNextLesson(
  userId: string,
  targetDisciplineSection: CpaSection | null
): Promise<NextLessonResult> {
  const { subtopics, topicMap, bestScoreMap } = await getOrderedCurriculum(userId, targetDisciplineSection);

  let passedCount = 0;
  let nextLesson: OrderedSubtopic | null = null;

  for (const subtopic of subtopics) {
    const bestScore = bestScoreMap.get(subtopic.id) ?? null;
    const passed = (bestScore ?? 0) >= SUBTOPIC_PASS_THRESHOLD;
    if (passed) {
      passedCount++;
    } else if (!nextLesson) {
      nextLesson = subtopic;
    }
  }

  const totalCount = subtopics.length;

  if (!nextLesson) {
    return { complete: true, passedCount, totalCount };
  }

  const topic = topicMap.get(nextLesson.topic_id)!;
  const bestScore = bestScoreMap.get(nextLesson.id) ?? null;

  return {
    complete: false,
    topicSlug: topic.slug,
    topicName: topic.name,
    subtopicSlug: nextLesson.slug,
    subtopicName: nextLesson.name,
    subject: topic.subject,
    difficulty: nextLesson.difficulty,
    estimatedMinutes: nextLesson.estimated_minutes,
    attempted: bestScore !== null,
    bestScorePct: bestScore !== null ? Math.round(bestScore * 100) : null,
    passedCount,
    totalCount,
  };
}

/**
 * Returns a map of subtopicId -> locked, for every subtopic in the user's
 * relevant curriculum. A subtopic is unlocked once every subtopic before it
 * in sequence has been passed — it's the "current" one you're working toward,
 * or one you've already cleared. Everything after that frontier is locked.
 */
export async function getCurriculumLockMap(
  userId: string,
  targetDisciplineSection: CpaSection | null
): Promise<Map<string, boolean>> {
  const { subtopics, bestScoreMap } = await getOrderedCurriculum(userId, targetDisciplineSection);

  const lockMap = new Map<string, boolean>();
  let unlockedSoFar = true;

  for (const subtopic of subtopics) {
    if (unlockedSoFar) {
      lockMap.set(subtopic.id, false);
      const passed = (bestScoreMap.get(subtopic.id) ?? 0) >= SUBTOPIC_PASS_THRESHOLD;
      if (!passed) unlockedSoFar = false;
    } else {
      lockMap.set(subtopic.id, true);
    }
  }

  return lockMap;
}
