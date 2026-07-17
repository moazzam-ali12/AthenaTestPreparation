"use client";

import { usePathname } from "next/navigation";
import { FloatingAITutor } from "./floating-ai-tutor";

// Pages that already have a dedicated tutor FAB or are full-screen test environments
const EXCLUDED_SEGMENTS = ["/quiz", "/tutor", "/micro-lesson", "/practice-exam"];

export function FloatingAITutorWrapper() {
  const pathname = usePathname();
  const isExcluded = EXCLUDED_SEGMENTS.some((seg) => pathname.includes(seg));
  if (isExcluded) return null;
  return <FloatingAITutor />;
}
