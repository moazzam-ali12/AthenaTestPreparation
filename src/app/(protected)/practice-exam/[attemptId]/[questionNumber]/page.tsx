"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { useCpaExamContext } from "@/components/cpa-exam/cpa-exam-context";
import { Toolbar } from "@/components/quiz/toolbar";
import { SegmentProgressBar } from "@/components/quiz/segment-progress-bar";
import { QuestionPanel } from "@/components/quiz/question-panel";
import { AnswerPanel } from "@/components/quiz/answer-panel";
import { BottomBar } from "@/components/quiz/bottom-bar";
import { Calculator } from "@/components/quiz/calculator";

export default function CpaExamQuestionPage() {
  const router = useRouter();
  const params = useParams<{ attemptId: string; questionNumber: string }>();
  const questionNum = Math.max(1, parseInt(params.questionNumber, 10) || 1);
  const ctx = useCpaExamContext();

  const [calcOpen, setCalcOpen] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);

  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      const targetIndex = questionNum - 1;
      if (
        targetIndex !== ctx.currentIndex &&
        targetIndex >= 0 &&
        targetIndex < ctx.totalQuestions
      ) {
        ctx.goTo(targetIndex);
      }
      return;
    }
    router.push(`/practice-exam/${params.attemptId}/${ctx.currentIndex + 1}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.currentIndex]);

  const currentProblem = ctx.currentProblem;
  if (!currentProblem) return null;

  const asProblem = {
    id: currentProblem.problemId,
    orderIndex: currentProblem.orderIndex,
    difficulty: currentProblem.difficulty,
    questionText: currentProblem.questionText,
    options: currentProblem.options,
    correctOption: -1,
    explanation: "",
    solutionSteps: [],
    hint: "",
    detailedHint: undefined,
    timeRecommendationSeconds: 90,
  };

  const isLow = ctx.timeLeft < 300;
  const moduleLabel = `Module ${currentProblem.module}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <Toolbar
        displayTime={ctx.displayTime}
        isLow={isLow}
        timerHidden={timerHidden}
        onToggleTimer={() => setTimerHidden((h) => !h)}
        calcOpen={calcOpen}
        onToggleCalc={() => setCalcOpen((o) => !o)}
        onClose={() => router.push("/practice-exam")}
        hasAnswers={ctx.answeredCount > 0}
        subtopicName={`${ctx.test.section} - ${moduleLabel}`}
        showCalc
        title={`${ctx.test.section} Practice Exam`}
      />

      <SegmentProgressBar
        total={ctx.totalQuestions}
        currentIndex={ctx.currentIndex}
        getStatus={(i) => ctx.getQuestionStatus(i)}
        onNavigate={() => {}}
      />

      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50">
        <span className="text-xs font-semibold text-muted-foreground">
          {ctx.test.section}
        </span>
        <span className="text-xs text-muted-foreground/50">|</span>
        <span className="text-xs font-medium text-primary">{moduleLabel}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Q{ctx.currentIndex + 1} of {ctx.totalQuestions}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-full flex-col md:flex-row md:divide-x">
          <QuestionPanel
            problem={asProblem}
            questionNumber={ctx.currentIndex + 1}
          />
          <AnswerPanel
            problem={asProblem}
            questionNumber={ctx.currentIndex + 1}
            selectedOption={ctx.answers.get(currentProblem.problemId)}
            isMarked={false}
            onSelect={(i) => ctx.handleSelectAnswer(currentProblem.problemId, i)}
            onToggleMark={() => {}}
            direction={ctx.direction}
            disabled={false}
            showMark={false}
          />
        </div>
      </div>

      <BottomBar
        currentIndex={ctx.currentIndex}
        total={ctx.totalQuestions}
        unansweredCount={
          Array.from({ length: ctx.totalQuestions }, (_, i) =>
            ctx.getQuestionStatus(i)
          ).filter((s) => s === "unanswered").length
        }
        onBack={() => {
          if (ctx.currentIndex > 0) ctx.goBack();
        }}
        onNext={() => {
          if (ctx.currentIndex < ctx.totalQuestions - 1) ctx.goNext();
        }}
        onGoTo={(i) => ctx.goTo(i)}
        onSubmit={() => ctx.submitExam()}
        getStatus={(i) => ctx.getQuestionStatus(i)}
        sequential={false}
        nextDisabled={false}
      />

      <AnimatePresence>{calcOpen && <Calculator />}</AnimatePresence>
    </div>
  );
}
