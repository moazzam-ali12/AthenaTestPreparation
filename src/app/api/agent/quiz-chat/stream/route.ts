import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getUserSkillProfile } from "@/lib/db/queries/subsection-skills";
import { chargeTutorMessage, refundOnStreamError } from "@/lib/tutor-cap";
import { supabase } from "@/lib/supabase/client";
import { getFollowUpPracticeLinks } from "@/lib/db/queries/tutor-practice";
import { isTutorRequestMode, withTrailingEvent, type TutorRequestMode } from "@/lib/tutor-modes";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    question,
    topic,
    subtopic,
    questionText,
    options,
    hint,
    solutionSteps,
    correctOption: clientCorrectOption,
    problemId,
    studentAnswer,
    history,
    subtopicId,
    mode: rawMode,
  } = body as {
    question: string;
    topic: string;
    subtopic: string;
    questionText: string;
    options: string[];
    hint: string;
    solutionSteps: { step: number; instruction: string; math: string }[];
    correctOption?: number;
    problemId?: string;
    studentAnswer?: number;
    history?: { role: string; content: string }[];
    subtopicId?: string;
    mode?: unknown;
  };
  const mode: TutorRequestMode = isTutorRequestMode(rawMode) ? rawMode : "hint";
  // "Answered" = the candidate picked an option. Picking one is also what
  // reveals the key to the browser (/api/act-quiz/answer), so this unlocks
  // nothing they could not already see. Unanswered → the agent's leak guard
  // strips the correct option from every mode's output.
  const answered = typeof studentAnswer === "number" && studentAnswer >= 0;

  if (!question || !questionText) {
    return NextResponse.json(
      { error: "Question is required" },
      { status: 400 }
    );
  }

  const user = await getUserByClerkId(clerkId);
  if (user) track("tutor_used", { surface: "quiz" }, user.id);

  // Server-graded practice and not-yet-answered quiz questions never send
  // their key to the browser: resolve it here. A server-held key always wins
  // over a client-sent one, so the leak guard protects the real answer.
  let correctOption = clientCorrectOption;
  let steps = solutionSteps;
  if (problemId) {
    const { data: key } = (await (supabase as any)
      .from("problems")
      .select("correct_option, solution_steps, source, custom_topics(user_id)")
      .eq("id", problemId)
      .in("source", ["practice", "cpa", "custom"])
      .maybeSingle()) as {
      data: {
        correct_option: number;
        solution_steps: typeof solutionSteps | null;
        source: string;
        custom_topics: { user_id: string } | null;
      } | null;
    };
    // Custom-topic questions only for their owner.
    if (key && (key.source !== "custom" || key.custom_topics?.user_id === user?.id)) {
      correctOption = key.correct_option;
      if (!steps?.length) steps = key.solution_steps ?? [];
    }
  }
  if (typeof correctOption !== "number") {
    return NextResponse.json({ error: "Question not found" }, { status: 400 });
  }

  if (mode === "why_wrong" && (!answered || studentAnswer === correctOption)) {
    return NextResponse.json({ error: "Answer the question (incorrectly) first." }, { status: 400 });
  }

  // Trial daily cap: charge before the LLM call; refunded below if it fails.
  let charge: Awaited<ReturnType<typeof chargeTutorMessage>>;
  try {
    charge = await chargeTutorMessage(user);
  } catch (err) {
    console.error("[agent/quiz-chat/stream] tutor cap check failed:", err);
    return NextResponse.json({ error: "AI tutor is currently unavailable. Please try again later." }, { status: 503 });
  }
  if (charge.blocked) return charge.blocked;

  // Derive the candidate's proficiency so the tutor can adapt its scaffolding
  // and vocabulary to their demonstrated level. Non-fatal if unavailable.
  let skillLevel: string | null = null;
  let performanceSummary: string | null = null;
  try {
    if (user) {
      const profile = await getUserSkillProfile(user.id, subtopicId);
      if (profile) {
        skillLevel = profile.band;
        performanceSummary = `avg skill level ${profile.avgLevel}/10, overall accuracy ${profile.overallAccuracy}% over ${profile.totalAttempts} attempts`;
      }
    }
  } catch (err) {
    console.error("[agent/quiz-chat/stream] skill profile lookup failed:", err);
  }

  try {
    const res = await fetch(`${AGENT_URL}/quiz-chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        topic,
        subtopic,
        question_text: questionText,
        options,
        hint,
        solution_steps: steps,
        correct_option: correctOption,
        student_answer: answered ? studentAnswer : null,
        mode,
        history: history ?? [],
        skill_level: skillLevel,
        performance_summary: performanceSummary,
      }),
    });

    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => "no body");
      console.error(`[agent/quiz-chat/stream] Agent returned ${res.status}:`, errorBody);
      throw new Error(`Agent service returned ${res.status}: ${errorBody}`);
    }

    // "Why was I wrong?" ends with 2 follow-up practice questions from the same subtopic.
    const upstream =
      mode === "why_wrong" && problemId
        ? withTrailingEvent(res.body, async () => ({
            practice_links: await getFollowUpPracticeLinks(problemId, 2),
          }))
        : res.body;

    return new Response(refundOnStreamError(upstream, charge.refund), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[agent/quiz-chat/stream] Error:", err);
    await charge.refund();
    return NextResponse.json(
      { error: "AI tutor is currently unavailable. Please try again later." },
      { status: 503 }
    );
  }
}
