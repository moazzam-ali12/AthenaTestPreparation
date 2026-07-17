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

export type QuizPhase = "active" | "submitted";

export type QuestionStatus = "unanswered" | "answered" | "marked";

export type QuestionPhase = "question" | "hint" | "hint2" | "tutor" | "practice";
