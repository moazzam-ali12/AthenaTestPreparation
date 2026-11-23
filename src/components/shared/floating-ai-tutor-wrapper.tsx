"use client";

import { usePathname } from "next/navigation";
import { FloatingAITutor } from "./floating-ai-tutor";
import { useAccess } from "@/hooks/use-trial";
import { hasTutorAccess } from "@/lib/trial";

// Pages that already have a dedicated tutor FAB or are full-screen test environments
const EXCLUDED_SEGMENTS = ["/quiz", "/tutor", "/micro-lesson", "/practice-exam"];

export function FloatingAITutorWrapper() {
  const pathname = usePathname();
  const { tier } = useAccess();
  const isExcluded = EXCLUDED_SEGMENTS.some((seg) => pathname.includes(seg));
  // The tutor calls paid AI endpoints: Pro, plus trial while TUTOR_ENABLED_IN_TRIAL (daily cap).
  if (isExcluded || !hasTutorAccess(tier)) return null;
  return <FloatingAITutor />;
}
