"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Check, X, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MathContent } from "./math-content";
import { useSound } from "@/hooks/useSound";
import type { Problem } from "./types";
import {
  cardReducer,
  gradeLocally,
  initialCardState,
  isFinalMiss,
  type AnswerKey,
  type OptionHint,
} from "./practice-card-machine";

/**
 * A practice problem. Locally graded problems carry their key; server-graded
 * ones (`graded: "server"`) don't, and are checked through `gradeAnswer`.
 */
export type PracticeProblem = Omit<Problem, "correctOption" | "explanation" | "solutionSteps"> &
  Partial<Pick<Problem, "correctOption" | "explanation" | "solutionSteps">> & { graded?: "server" };

export type ServerGrade = { isCorrect: boolean; optionHint?: OptionHint; answer?: AnswerKey };

type PracticeGradientCardProps = {
  problem: PracticeProblem;
  questionNumber: number;
  /** Called when the student answers correctly. */
  onCorrect: () => void;
  /** Called once after the answer is revealed (attempts used up). Never after a correct answer. */
  onExhausted: () => void;
  /** Server grader, required for `graded: "server"` problems. `reveal` asks for the key on the final miss. */
  gradeAnswer?: (problemId: string, option: number, reveal: boolean) => Promise<ServerGrade>;
};

const CORRECT_DELAY_MS = 1000;
const REVEAL_DELAY_MS = 2500;

// Keyed by problem id so a new problem always starts from a fresh state.
export function PracticeGradientCard(props: PracticeGradientCardProps) {
  return <PracticeGradientCardInner key={props.problem.id} {...props} />;
}

function PracticeGradientCardInner({
  problem,
  questionNumber,
  onCorrect,
  onExhausted,
  gradeAnswer,
}: PracticeGradientCardProps) {
  const [state, dispatch] = useReducer(cardReducer, initialCardState);
  const sound = useSound();

  // Latest callbacks in refs: parents pass inline handlers, and depending on
  // them used to cancel the reveal timer on every re-render.
  const onCorrectRef = useRef(onCorrect);
  const onExhaustedRef = useRef(onExhausted);
  useEffect(() => {
    onCorrectRef.current = onCorrect;
    onExhaustedRef.current = onExhausted;
  });

  const { status, selected, answer, optionHint } = state;
  const isCorrect = status === "correct" || status === "done";
  const isRevealed = status === "revealed" || status === "exhausted";
  const isFinished = isCorrect || isRevealed;
  const correctOption = answer?.correctOption;

  // Terminal transitions: timers depend only on `status`, so re-renders can't
  // drop them; the reducer guarantees each callback fires at most once.
  useEffect(() => {
    if (status !== "correct" && status !== "revealed") return;
    const t = setTimeout(() => dispatch({ type: "advance" }), status === "correct" ? CORRECT_DELAY_MS : REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [status]);
  useEffect(() => {
    if (status === "done") onCorrectRef.current();
    else if (status === "exhausted") onExhaustedRef.current();
  }, [status]);

  const handleSelect = useCallback(
    async (index: number) => {
      if ((status !== "answering" && status !== "hinted") || state.wrong.includes(index)) return;
      dispatch({ type: "submit", option: index });
      let event;
      if (problem.graded === "server") {
        if (!gradeAnswer) return dispatch({ type: "gradeFailed" });
        try {
          const g = await gradeAnswer(problem.id, index, isFinalMiss(state));
          event = { type: "graded" as const, option: index, ...g };
        } catch {
          toast.error("Couldn't check that answer. Please try again.");
          return dispatch({ type: "gradeFailed" });
        }
      } else {
        event = gradeLocally(problem, index);
      }
      if (event.isCorrect) sound.achievement();
      else sound.wrong();
      dispatch(event);
    },
    [status, state, problem, gradeAnswer, sound]
  );

  const showHint = status === "hinted" || (status === "grading" && state.resumeStatus === "hinted");

  return (
    <div className="flex flex-col gap-4 p-4" data-practice-status={status}>
      {/* Question number + text */}
      <div className="space-y-2">
        <span className="text-xs font-medium text-muted-foreground">
          Question {questionNumber}
        </span>
        <div className="text-sm font-medium">
          <MathContent content={problem.questionText} />
        </div>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {problem.options.map((option, i) => {
          const isThis = selected === i;
          const isRight = isFinished && i === correctOption;
          const isWrong = state.wrong.includes(i);
          const isPending = status === "grading" && isThis;

          return (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              disabled={isFinished || isWrong || status === "grading"}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                !isFinished && !isWrong && status !== "grading" && "hover:bg-muted cursor-pointer",
                isRight && "border-green-500 bg-green-500/10",
                isFinished && isWrong && "border-red-500 bg-red-500/10",
                isFinished && !isRight && !isWrong && "opacity-50",
                isWrong && !isFinished && "border-red-500/50 bg-red-500/5 opacity-60",
                isPending && "border-primary/60",
              )}
              style={isRight ? { boxShadow: "0 0 12px rgba(34, 197, 94, 0.3)" } : undefined}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium mt-0.5",
                  isRight && "border-green-500 bg-green-500 text-white",
                  isWrong && "border-red-500 bg-red-500 text-white",
                )}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : isRight ? (
                  <Check className="h-3 w-3" />
                ) : isWrong ? (
                  <X className="h-3 w-3" />
                ) : (
                  String.fromCharCode(65 + i)
                )}
              </span>
              <span className="flex-1 leading-relaxed">
                <MathContent content={option} />
              </span>
            </button>
          );
        })}
      </div>

      {/* After the first miss: nudge hint (amber) + walkthrough (blue) */}
      {showHint && (optionHint || problem.hint) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-0.5">
            {optionHint ? optionHint.misconception : "Think about it:"}
          </p>
          <p className="text-sm text-muted-foreground">
            <MathContent content={optionHint?.hint ?? problem.hint} />
          </p>
        </motion.div>
      )}
      {showHint && problem.detailedHint && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-0.5">
            Let me walk you through it:
          </p>
          <p className="text-sm text-muted-foreground">
            <MathContent content={problem.detailedHint} />
          </p>
        </motion.div>
      )}

      {/* Finished — explanation */}
      {isFinished && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-1.5"
        >
          {isCorrect ? (
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex items-center gap-1.5 text-green-500"
            >
              <Check className="h-4 w-4" />
              <span className="text-sm font-bold">Correct!</span>
            </motion.div>
          ) : (
            <p className="text-sm font-bold text-muted-foreground">
              {correctOption !== undefined && correctOption >= 0
                ? `The answer is ${String.fromCharCode(65 + correctOption)}.`
                : "Here's the answer."}
            </p>
          )}
          {answer?.explanation && (
            <div className="text-xs text-muted-foreground">
              <MathContent content={answer.explanation} />
            </div>
          )}
          {answer?.conceptTags && answer.conceptTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {answer.conceptTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  {tag.replace(/-/g, " ")}
                </span>
              ))}
            </div>
          )}
          {status === "revealed" && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-xs"
              onClick={() => dispatch({ type: "advance" })}
            >
              Got it, continue
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </motion.div>
      )}
    </div>
  );
}
