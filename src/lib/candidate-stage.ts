// Where the user is in their CPA journey. Collected in onboarding step 2 and
// stored in `user_preferences.grade` (column name predates the CPA product).

export const CANDIDATE_STAGES = [
  {
    value: "undergraduate",
    label: "Undergraduate Student",
    guidance:
      "Still in their accounting degree and likely not yet eligible to sit. Long runway: build fundamentals, connect topics to their current coursework, and keep sessions light and consistent rather than exam-crunch intense.",
  },
  {
    value: "final_year",
    label: "College Senior / Final-Year Student",
    guidance:
      "Close to graduating and approaching eligibility. Help them plan which section to sit first and when, around graduation. Their coursework is fresh, so lean on it and start building exam stamina.",
  },
  {
    value: "recent_graduate",
    label: "Recent Graduate",
    guidance:
      "Coursework is fresh and they usually have the most study time they will ever have. Encourage an ambitious, structured schedule and sitting for a first section soon while knowledge is fresh.",
  },
  {
    value: "postgraduate",
    label: "Postgraduate / Master's Student",
    guidance:
      "Likely completing credit hours toward licensure while studying. Help them balance graduate coursework with exam prep and use overlap between their classes and CPA topics.",
  },
  {
    value: "working_professional",
    label: "Working Professional",
    guidance:
      "Studying around a full-time job. Time is the main constraint: recommend short, focused sessions, plan around busy season, and connect concepts to what they see at work.",
  },
  {
    value: "cpa_candidate",
    label: "CPA Candidate",
    guidance:
      "Already actively sitting for sections. Focus on exam strategy, the 75 passing score, and their section credit window (18 to 30 months depending on jurisdiction). Prioritize the next scheduled section and weak areas within it.",
  },
] as const;

export type CandidateStage = (typeof CANDIDATE_STAGES)[number]["value"];

export function isCandidateStage(value: unknown): value is CandidateStage {
  return CANDIDATE_STAGES.some((s) => s.value === value);
}

// Returns null for missing or legacy values (e.g. "11th Grade" from the ACT-era picker).
export function getCandidateStage(value: string | null | undefined) {
  return CANDIDATE_STAGES.find((s) => s.value === value) ?? null;
}
