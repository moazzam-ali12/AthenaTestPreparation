"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCpaExamContext } from "@/components/cpa-exam/cpa-exam-context";

export default function CpaExamAttemptPage() {
  const router = useRouter();
  const { attempt, currentIndex } = useCpaExamContext();

  useEffect(() => {
    router.replace(`/practice-exam/${attempt.id}/${currentIndex + 1}`);
  }, [router, attempt.id, currentIndex]);

  return null;
}
