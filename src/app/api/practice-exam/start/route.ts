import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import {
  getInProgressAttempt,
  createAttempt,
  getTestProblems,
  createAnswerRows,
  getAttemptAnswers,
  getActiveTestsForSection,
  getTestById,
} from "@/lib/db/queries/cpa-exam";
import type { CpaSection, CpaExamStartResponse, CpaSubject } from "@/types/cpa-exam";
import { NextResponse } from "next/server";
import { getFeatureTier } from "@/lib/subscription";
import { consumeTrialItem } from "@/lib/db/queries/trial";
import { featureLockedResponse, trialLimitResponse } from "@/lib/trial-gate";
import { pickSampleProblems, SAMPLE_TEST_QUESTIONS } from "@/lib/trial";
import { examDurationMinutes, redactProblem, startOrResumeAttempt } from "@/lib/practice-exam";

const VALID_SECTIONS: CpaSection[] = ["AUD", "FAR", "REG", "BAR", "ISC", "TCP"];

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { section, testId } = (await req.json()) as {
    section: CpaSection;
    testId?: string;
  };

  if (!section || !VALID_SECTIONS.includes(section)) {
    return NextResponse.json({ error: "Valid section is required" }, { status: 400 });
  }

  // Limited free trial: one short sample test per account instead of full-length
  // mock exams (a full-mode trial gets the real exam, like Pro).
  const isTrial = getFeatureTier(user) !== "pro";
  const subject = section.toLowerCase() as CpaSubject;

  // Idempotent: an in-progress attempt for this section is resumed (no quota
  // use, no new row); the sample quota is consumed only when a NEW sample is created.
  const outcome = await startOrResumeAttempt({
    sample: isTrial,
    findInProgress: () => getInProgressAttempt(user.id, section),
    prepare: async () => {
      // Resolve which test to start: explicit testId, or first active test for section
      let resolvedTestId = testId;
      if (!resolvedTestId) {
        const activeTests = await getActiveTestsForSection(section);
        if (activeTests.length === 0) {
          return { ok: false as const, error: { message: "No active exams available for this section", status: 404 } };
        }
        resolvedTestId = activeTests[0].id;
      }

      const test = await getTestById(resolvedTestId);
      if (!test || test.section !== section) {
        return { ok: false as const, error: { message: "Exam not found for section", status: 404 } };
      }

      const allProblems = await getTestProblems(resolvedTestId);
      if (allProblems.length === 0) {
        return { ok: false as const, error: { message: "Exam has no problems", status: 404 } };
      }
      return { ok: true as const, value: { test, allProblems } };
    },
    consumeSampleQuota: async () =>
      (await consumeTrialItem(user.id, subject, "sample_test", crypto.randomUUID())).allowed,
    create: async ({ test, allProblems }) => {
      const problems = isTrial ? pickSampleProblems(allProblems, SAMPLE_TEST_QUESTIONS) : allProblems;
      const attempt = await createAttempt(user.id, test.id, section, isTrial);
      await createAnswerRows(attempt.id, problems);
      return attempt;
    },
  });

  if (outcome.kind === "error") {
    return NextResponse.json({ error: outcome.error.message }, { status: outcome.error.status });
  }
  if (outcome.kind === "limit") return trialLimitResponse("sample_test", subject);

  const attempt = outcome.attempt;
  const answers = await getAttemptAnswers(attempt.id);
  // A trial user may only resume a sample-sized attempt.
  if (isTrial && answers.length > SAMPLE_TEST_QUESTIONS) return featureLockedResponse();

  const test = await getTestById(attempt.testId);
  const answerKeys = new Set(answers.map((a) => `${a.module}:${a.orderIndex}`));
  const problems = (await getTestProblems(attempt.testId)).filter((p) =>
    answerKeys.has(`${p.module}:${p.orderIndex}`)
  );

  const response: CpaExamStartResponse = {
    attemptId: attempt.id,
    test: test ?? {
      id: attempt.testId,
      section,
      testNumber: 0,
      name: "",
      status: "active",
      createdAt: "",
    },
    problems: problems.map(redactProblem),
    answers,
    isSample: attempt.isSample,
    durationMinutes: examDurationMinutes(attempt),
  };

  return NextResponse.json(response);
}
