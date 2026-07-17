"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { useQuizRouteContext } from "@/components/learning/quiz/quiz-route-context";
import { Toolbar } from "@/components/quiz/toolbar";
import { SegmentProgressBar } from "@/components/quiz/segment-progress-bar";
import { QuestionPanel } from "@/components/quiz/question-panel";
import { AnswerPanel } from "@/components/quiz/answer-panel";
import { BottomBar } from "@/components/quiz/bottom-bar";
import { Calculator } from "@/components/quiz/calculator";
import { ResultsScreen } from "@/components/quiz/results-screen";
import { PostLessonPractice } from "@/components/learning/post-lesson-practice";
import { StuckModal } from "@/components/quiz/stuck-modal";
import { UnlockCelebration } from "@/components/shared/unlock-celebration";

export function QuizProblemPageContent() {
  const router = useRouter();
  const params = useParams<{ problemNumber: string }>();
  const problemNum = Math.max(1, parseInt(params.problemNumber, 10) || 1);
  const {
    problems,
    topicName,
    subtopicName,
    subject,
    basePath,
    quiz,
    timer,
    feedbackMap,
    lockedIds,
    direction,
    setSaveStatus,
    setFeedbackMap,
    setLockedIds,
    handleSelectAnswer,
    stuckModalShownIds,
    markStuckModalShown,
    unlockData,
    struggling,
  } = useQuizRouteContext();

  const [calcOpen, setCalcOpen] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [practiceCompleted, setPracticeCompleted] = useState(false);
  const [showStuckModal, setShowStuckModal] = useState(false);
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);

  const { mutate: fetchSummary, data: aiSummary } = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/lesson-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicName,
          subtopicName,
          lessonType: "quiz",
          score: { correct: quiz.score, total: problems.length },
        }),
      });
      if (!res.ok) throw new Error("Failed to generate summary");
      return res.json() as Promise<{
        greeting: string;
        summary: string;
        encouragement: string;
      }>;
    },
  });

  const quizBase = `${basePath}/quiz`;

  // On first mount: sync quiz state to the URL param (handles refresh / direct navigation).
  // On subsequent index changes: sync URL to quiz state (handles advancing questions).
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      const targetIndex = problemNum - 1;
      if (targetIndex !== quiz.currentIndex && targetIndex >= 0 && targetIndex < problems.length) {
        quiz.goTo(targetIndex);
      }
      return;
    }
    router.push(`${quizBase}/${quiz.currentIndex + 1}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz.currentIndex]);

  const currentProblem = problems[quiz.currentIndex];
  const questionPhase = currentProblem ? quiz.getQuestionPhase(currentProblem.id) : "question";
  const hasCorrectAnswer =
    currentProblem && quiz.answers.get(currentProblem.id) === currentProblem.correctOption;
  const canAdvance = questionPhase === "question" && !!hasCorrectAnswer;

  // Fetch AI summary when quiz is submitted
  const summaryFetchedRef = useRef(false);
  useEffect(() => {
    if (quiz.phase === "submitted" && !summaryFetchedRef.current) {
      summaryFetchedRef.current = true;
      fetchSummary();
    }
  }, [quiz.phase, fetchSummary]);

  // Show stuck modal when question enters tutor phase (only once per problem)
  useEffect(() => {
    if (questionPhase === "tutor" && currentProblem && !stuckModalShownIds.has(currentProblem.id)) {
      setShowStuckModal(true);
    }
  }, [questionPhase, currentProblem, stuckModalShownIds]);

  const handleStuckModalComplete = useCallback(() => {
    if (currentProblem) markStuckModalShown(currentProblem.id);
    setShowStuckModal(false);
    router.push(`${quizBase}/${quiz.currentIndex + 1}/tutor`);
  }, [router, quizBase, quiz.currentIndex, currentProblem, markStuckModalShown]);

  if (!currentProblem) return null;

  if (quiz.phase === "submitted") {
    if (showPractice) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <PostLessonPractice
            topic={topicName}
            subtopic={subtopicName}
            subject={subject ?? "math"}
            onComplete={() => {
              setShowPractice(false);
              setPracticeCompleted(true);
            }}
          />
        </div>
      );
    }
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {unlockData && !celebrationDismissed && (
          <UnlockCelebration
            newBadges={unlockData.newBadges}
            rankUp={unlockData.rankUp}
            onDismiss={() => setCelebrationDismissed(true)}
          />
        )}
        <ResultsScreen
          problems={problems}
          answers={quiz.answers}
          score={quiz.score}
          elapsed={timer.elapsed}
          aiSummary={aiSummary}
          onRetry={() => {
            setSaveStatus("idle");
            setFeedbackMap(new Map());
            setLockedIds(new Set());
            setShowPractice(false);
            setPracticeCompleted(false);
            quiz.restart();
            router.push(`${quizBase}/1`);
          }}
          onClose={
            practiceCompleted
              ? () => router.push(basePath)
              : undefined
          }
          onPractice={practiceCompleted ? undefined : () => setShowPractice(true)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <Toolbar
        displayTime={timer.displayTime}
        isLow={timer.isLow}
        timerHidden={timer.hidden}
        onToggleTimer={timer.toggleHidden}
        calcOpen={calcOpen}
        onToggleCalc={() => setCalcOpen((o) => !o)}
        onClose={() => router.push(basePath)}
        hasAnswers={quiz.answers.size > 0}
        subtopicName={subtopicName}
      />
      <SegmentProgressBar
        total={problems.length}
        currentIndex={quiz.currentIndex}
        getStatus={quiz.getQuestionStatus}
        onNavigate={() => {}}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-full flex-col md:flex-row md:divide-x">
          <QuestionPanel
            problem={currentProblem}
            questionNumber={quiz.currentIndex + 1}
          />
          <AnswerPanel
            problem={currentProblem}
            questionNumber={quiz.currentIndex + 1}
            selectedOption={quiz.answers.get(currentProblem.id)}
            isMarked={quiz.markedIds.has(currentProblem.id)}
            onSelect={(i) => handleSelectAnswer(currentProblem.id, i)}
            onToggleMark={() => quiz.toggleMark(currentProblem.id)}
            direction={direction}
            feedbackState={feedbackMap.get(currentProblem.id)}
            disabled={lockedIds.has(currentProblem.id)}
          >
            {questionPhase === "hint" && currentProblem.hint && (() => {
              const selectedOption = quiz.answers.get(currentProblem.id);
              const optionHint = currentProblem.optionHints?.find(
                (oh) => oh.optionIndex === selectedOption
              );
              return (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-lg border border-athena-amber/40 bg-athena-amber/10 px-4 py-3"
                >
                  <p className="text-xs font-bold uppercase tracking-widest text-athena-amber mb-1">
                    {optionHint ? optionHint.misconception : "Hint"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {optionHint?.hint ?? currentProblem.hint}
                  </p>
                  {struggling && currentProblem.detailedHint && (
                    <p className="mt-2 border-t border-athena-amber/30 pt-2 text-sm text-muted-foreground">
                      {currentProblem.detailedHint}
                    </p>
                  )}
                </motion.div>
              );
            })()}
          </AnswerPanel>
        </div>
      </div>

      <BottomBar
        currentIndex={quiz.currentIndex}
        total={problems.length}
        unansweredCount={quiz.unansweredCount}
        onBack={quiz.goBack}
        onNext={quiz.goNext}
        onGoTo={quiz.goTo}
        onSubmit={quiz.submit}
        getStatus={quiz.getQuestionStatus}
        sequential={true}
        nextDisabled={!canAdvance}
      />

      <AnimatePresence>
        {calcOpen && quiz.phase === "active" && <Calculator />}
      </AnimatePresence>

      <AnimatePresence>
        {showStuckModal && (
          <StuckModal onComplete={handleStuckModalComplete} />
        )}
      </AnimatePresence>
    </div>
  );
}
