import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getCurriculumLockMap } from "@/lib/db/queries/next-lesson";

export async function GET(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  const lockMap = user
    ? await getCurriculumLockMap(user.id, user.targetDisciplineSection)
    : new Map<string, boolean>();

  const subject = request.nextUrl.searchParams.get("subject");

  let topicsQuery = supabase
    .from("topics")
    .select("id, slug, name, icon, color_scheme, overview, estimated_total_minutes, cpa_relevance, difficulty_distribution, order_index, subject")
    .order("order_index", { ascending: true });

  if (subject) {
    topicsQuery = topicsQuery.eq("subject", subject);
  }

  const [topicsRes, subtopicsRes] = await Promise.all([
    topicsQuery,
    supabase
      .from("subtopics")
      .select("id, topic_id, slug, name, difficulty, estimated_minutes, description, order_index")
      .order("order_index", { ascending: true }),
  ]);

  const allTopics = (topicsRes.data ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    icon: t.icon,
    colorScheme: t.color_scheme,
    overview: t.overview,
    estimatedTotalMinutes: t.estimated_total_minutes,
    cpaRelevance: t.cpa_relevance,
    difficultyDistribution: t.difficulty_distribution,
    orderIndex: t.order_index,
    subject: t.subject,
  }));

  const allSubtopics = (subtopicsRes.data ?? []).map((st) => ({
    id: st.id,
    topicId: st.topic_id,
    slug: st.slug,
    name: st.name,
    difficulty: st.difficulty,
    estimatedMinutes: st.estimated_minutes,
    description: st.description,
    orderIndex: st.order_index,
    locked: lockMap.get(st.id) ?? true,
  }));

  const topicsWithSubtopics = allTopics.map((topic) => {
    const subtopics = allSubtopics.filter((st) => st.topicId === topic.id);
    return {
      ...topic,
      subtopics,
      locked: subtopics.length === 0 || subtopics.every((st) => st.locked),
    };
  });

  return NextResponse.json({ topics: topicsWithSubtopics });
}
