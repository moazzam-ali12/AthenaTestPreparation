/**
 * Practice problems (problems.source = 'practice') are served without their
 * answer key and graded server-side, same rule as the exam/quest MCQs: the
 * key, explanation and solution only leave the server once the candidate has
 * answered correctly or used up their attempts.
 */

export type PracticeRow = {
  id: string;
  order_index: number;
  difficulty: string;
  question_text: string;
  options: string[];
  correct_option: number;
  explanation: string;
  solution_steps: { step: number; instruction: string; math: string }[] | null;
  hint: string | null;
  detailed_hint: string | null;
  time_recommendation_seconds: number;
  concept_tags: string[] | null;
  option_hints: { optionIndex: number; misconception: string; hint: string }[] | null;
};

/** Client payload before answering: no key, no explanation, no per-option hints. */
export function toPublicPracticeProblem(p: PracticeRow) {
  return {
    id: p.id,
    orderIndex: p.order_index,
    difficulty: p.difficulty,
    questionText: p.question_text,
    options: p.options,
    hint: p.hint ?? "",
    detailedHint: p.detailed_hint ?? undefined,
    timeRecommendationSeconds: p.time_recommendation_seconds,
    // Server-graded: the card POSTs answers instead of comparing locally.
    graded: "server" as const,
  };
}

export type PracticeGrade = {
  isCorrect: boolean;
  /** Hint for the option the candidate picked (wrong answers only). */
  optionHint?: { optionIndex: number; misconception: string; hint: string };
  /** Present only when correct or when the attempts are used up (`reveal`). */
  answer?: {
    correctOption: number;
    explanation: string;
    solutionSteps: { step: number; instruction: string; math: string }[];
    conceptTags: string[];
  };
};

export function gradePracticeAnswer(p: PracticeRow, selectedOption: number, reveal: boolean): PracticeGrade {
  const isCorrect = selectedOption === p.correct_option;
  const grade: PracticeGrade = { isCorrect };
  if (!isCorrect) {
    const oh = (p.option_hints ?? []).find((h) => h.optionIndex === selectedOption);
    if (oh) grade.optionHint = oh;
  }
  if (isCorrect || reveal) {
    grade.answer = {
      correctOption: p.correct_option,
      explanation: p.explanation,
      solutionSteps: p.solution_steps ?? [],
      conceptTags: p.concept_tags ?? [],
    };
  }
  return grade;
}
