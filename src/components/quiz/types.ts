export type SolutionStep = {
  step: number;
  instruction: string;
  math: string;
};

export type OptionHint = {
  optionIndex: number;
  misconception: string;
  hint: string;
};

export type Problem = {
  id: string;
  orderIndex: number;
  difficulty: string;
  questionText: string;
  options: string[];
  correctOption: number;
  explanation: string;
  solutionSteps: SolutionStep[];
  hint: string;
  detailedHint?: string;
  timeRecommendationSeconds: number;
  conceptTags?: string[];
  optionHints?: OptionHint[];
};

/** Answer-revealing fields: the server only sends these after a question is answered. */
export type AnswerReveal = Pick<
  Problem,
  "correctOption" | "explanation" | "solutionSteps" | "hint" | "detailedHint" | "optionHints"
>;

/** Placeholder for a question whose answer hasn't been revealed yet (-1 never matches an option). */
export const HIDDEN_ANSWER: AnswerReveal = {
  correctOption: -1,
  explanation: "",
  solutionSteps: [],
  hint: "",
  detailedHint: undefined,
  optionHints: [],
};

export type QuizPhase = "active" | "submitted";

export type QuestionStatus = "unanswered" | "answered" | "marked";

export type QuestionPhase = "question" | "hint" | "hint2" | "tutor" | "practice";
