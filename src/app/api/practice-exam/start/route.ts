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
import type { CpaSection, CpaExamStartResponse } from "@/types/cpa-exam";
import { NextResponse } from "next/server";

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

  // Resume existing in-progress attempt for this section
  const existing = await getInProgressAttempt(user.id, section);
  if (existing) {
    const test = await getTestById(existing.testId);
    const problems = await getTestProblems(existing.testId);
    const answers = await getAttemptAnswers(existing.id);

    const response: CpaExamStartResponse = {
      attemptId: existing.id,
      test: test ?? {
        id: existing.testId,
        section,
        testNumber: 0,
        name: "",
        status: "active",
        createdAt: "",
      },
      problems,
      answers,
    };

    return NextResponse.json(response);
  }

  // Resolve which test to start: explicit testId, or first active test for section
  let resolvedTestId = testId;
  if (!resolvedTestId) {
    const activeTests = await getActiveTestsForSection(section);
    if (activeTests.length === 0) {
      return NextResponse.json(
        { error: "No active exams available for this section" },
        { status: 404 }
      );
    }
    resolvedTestId = activeTests[0].id;
  }

  const test = await getTestById(resolvedTestId);
  if (!test || test.section !== section) {
    return NextResponse.json({ error: "Exam not found for section" }, { status: 404 });
  }

  const problems = await getTestProblems(resolvedTestId);
  if (problems.length === 0) {
    return NextResponse.json(
      { error: "Exam has no problems" },
      { status: 404 }
    );
  }

  const attempt = await createAttempt(user.id, resolvedTestId, section);
  await createAnswerRows(attempt.id, problems);
  const answers = await getAttemptAnswers(attempt.id);

  const response: CpaExamStartResponse = {
    attemptId: attempt.id,
    test,
    problems,
    answers,
  };

  return NextResponse.json(response);
}
