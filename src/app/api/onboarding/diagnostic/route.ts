import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { supabase } from "@/lib/supabase/client";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import { NextResponse } from "next/server";

// Diagnostic only covers the 3 mandatory core sections — the user hasn't
// picked a discipline section yet at this point in onboarding.
const SECTIONS = CPA_CORE_SECTIONS;
const PROBLEMS_PER_SECTION = 4;

async function getSubtopicIdsForSubject(subject: string): Promise<string[]> {
  const { data: topics } = await supabase
    .from("topics")
    .select("id")
    .eq("subject", subject.toLowerCase());

  if (!topics || topics.length === 0) return [];

  const topicIds = topics.map((t) => t.id);

  const { data: subtopics } = await supabase
    .from("subtopics")
    .select("id")
    .in("topic_id", topicIds);

  return (subtopics ?? []).map((s) => s.id);
}

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const sectionProblems = await Promise.all(
    SECTIONS.map(async (section) => {
      const subtopicIds = await getSubtopicIdsForSubject(section);

      if (subtopicIds.length === 0) {
        return { section, problems: [] };
      }

      // 1. Try act source, medium difficulty
      const { data: actMedium } = await supabase
        .from("problems")
        .select("id, question_text, options, correct_option, difficulty_level")
        .eq("source", "cpa")
        .in("subtopic_id", subtopicIds)
        .gte("difficulty_level", 3)
        .lte("difficulty_level", 6)
        .limit(PROBLEMS_PER_SECTION);

      if (actMedium && actMedium.length >= PROBLEMS_PER_SECTION) {
        return { section, problems: actMedium };
      }

      // 2. Try act source, any difficulty
      const { data: actAny } = await supabase
        .from("problems")
        .select("id, question_text, options, correct_option, difficulty_level")
        .eq("source", "cpa")
        .in("subtopic_id", subtopicIds)
        .limit(PROBLEMS_PER_SECTION);

      if (actAny && actAny.length >= PROBLEMS_PER_SECTION) {
        return { section, problems: actAny };
      }

      // 3. Fallback: any source in this subject's subtopics
      const { data: anySource } = await supabase
        .from("problems")
        .select("id, question_text, options, correct_option, difficulty_level")
        .in("subtopic_id", subtopicIds)
        .in("source", ["cpa", "practice", "onboarding"])
        .limit(PROBLEMS_PER_SECTION);

      return { section, problems: anySource ?? [] };
    })
  );

  const result = sectionProblems.map(({ section, problems }) => ({
    section,
    problems: problems.map((p) => ({
      id: p.id,
      questionText: p.question_text,
      options: p.options,
      difficultyLevel: p.difficulty_level,
    })),
  }));

  return NextResponse.json({ sections: result });
}
