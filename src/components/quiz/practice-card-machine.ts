/**
 * State machine for one practice question (PracticeGradientCard).
 *
 *   answering ──wrong (miss 1)──▶ hinted ──wrong (miss 2)──▶ revealed ──▶ exhausted
 *       │                           │
 *       └──────────correct──────────┴──▶ correct ──▶ done
 *
 * `revealed` shows the right answer + explanation but is never a correct
 * answer: it can only lead to `exhausted` (onExhausted), never to onCorrect.
 * `grading` is the in-flight state while a server-graded answer is checked.
 */

export const MAX_PRACTICE_MISSES = 2;

export type AnswerKey = {
  correctOption: number;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math: string }[];
  conceptTags: string[];
};

export type OptionHint = { optionIndex: number; misconception: string; hint: string };

export type CardStatus = "answering" | "grading" | "hinted" | "correct" | "revealed" | "done" | "exhausted";

export type CardState = {
  status: CardStatus;
  /** Status to return to if a server grade fails. */
  resumeStatus: "answering" | "hinted";
  misses: number;
  wrong: number[];
  selected: number | null;
  optionHint?: OptionHint;
  answer?: AnswerKey;
};

export type CardEvent =
  | { type: "submit"; option: number }
  | { type: "graded"; option: number; isCorrect: boolean; optionHint?: OptionHint; answer?: AnswerKey }
  | { type: "gradeFailed" }
  | { type: "advance" };

export const initialCardState: CardState = {
  status: "answering",
  resumeStatus: "answering",
  misses: 0,
  wrong: [],
  selected: null,
};

const canAnswer = (s: CardState) => s.status === "answering" || s.status === "hinted";

export function cardReducer(state: CardState, event: CardEvent): CardState {
  switch (event.type) {
    case "submit": {
      if (!canAnswer(state) || state.wrong.includes(event.option)) return state;
      return { ...state, status: "grading", resumeStatus: state.status as "answering" | "hinted", selected: event.option };
    }
    case "gradeFailed":
      return state.status === "grading" ? { ...state, status: state.resumeStatus } : state;
    case "graded": {
      if (state.status !== "grading" || event.option !== state.selected) return state;
      if (event.isCorrect) {
        return { ...state, status: "correct", answer: event.answer ?? state.answer, optionHint: undefined };
      }
      const misses = state.misses + 1;
      const wrong = [...state.wrong, event.option];
      return {
        ...state,
        misses,
        wrong,
        optionHint: event.optionHint,
        answer: event.answer ?? state.answer,
        status: misses >= MAX_PRACTICE_MISSES ? "revealed" : "hinted",
      };
    }
    case "advance":
      if (state.status === "correct") return { ...state, status: "done" };
      if (state.status === "revealed") return { ...state, status: "exhausted" };
      return state;
  }
}

/** True on the miss that uses up the last attempt: the grader should reveal the key. */
export const isFinalMiss = (s: CardState) => s.misses + 1 >= MAX_PRACTICE_MISSES;

/** Local (client-side) grading for problems that already carry their key. */
export function gradeLocally(
  problem: { correctOption?: number; explanation?: string; solutionSteps?: AnswerKey["solutionSteps"]; conceptTags?: string[]; optionHints?: OptionHint[] },
  option: number,
): Extract<CardEvent, { type: "graded" }> {
  const answer: AnswerKey = {
    correctOption: problem.correctOption ?? -1,
    explanation: problem.explanation ?? "",
    solutionSteps: problem.solutionSteps ?? [],
    conceptTags: problem.conceptTags ?? [],
  };
  return {
    type: "graded",
    option,
    isCorrect: option === problem.correctOption,
    optionHint: problem.optionHints?.find((h) => h.optionIndex === option),
    answer,
  };
}
