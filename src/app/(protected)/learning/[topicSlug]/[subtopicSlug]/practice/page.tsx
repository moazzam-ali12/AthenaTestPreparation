"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { TutorPracticeCard } from "@/components/quiz/tutor-practice-card";
import { parsePracticeIds } from "@/lib/tutor-modes";

/**
 * Follow-up practice opened from the quiz tutor's "Why was I wrong?" links
 * (`?ids=<practice problem id>`). Grading reuses the subtopic practice API.
 */
export default function SubtopicPracticePage() {
  return (
    <Suspense fallback={null}>
      <SubtopicPractice />
    </Suspense>
  );
}

function SubtopicPractice() {
  const params = useParams<{ topicSlug: string; subtopicSlug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const ids = parsePracticeIds(searchParams.get("ids"));
  const overview = `/learning/${params.topicSlug}/${params.subtopicSlug}`;
  const url = `/api/learning/${params.topicSlug}/${params.subtopicSlug}/practice-problems${
    ids.length ? `?ids=${ids.join(",")}` : ""
  }`;

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full px-4 py-6 flex justify-end">
      <Link href={overview} className="inline-flex h-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to subtopic
      </Link>
      {/* The practice card positions itself (fixed, top-left), as in the tutor. */}
      <TutorPracticeCard
        practiceProblemsUrl={url}
        onComplete={() => router.push(overview)}
        onNeedsMicroLesson={() => router.push(overview)}
      />
    </div>
  );
}
