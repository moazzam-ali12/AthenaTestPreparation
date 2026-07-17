import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { getProgressData } from "@/lib/db/queries/progress";
import { getDashboardData } from "@/lib/db/queries/dashboard";
import { getAllSectionProgress } from "@/lib/db/queries/cpa-exam";
import { CPA_CORE_SECTIONS } from "@/types/cpa-exam";
import { trimHistory } from "@/lib/trim-history";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8080";

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await req.json();
  const { question, history } = body as {
    question: string;
    history?: { role: string; content: string }[];
  };

  if (!question) {
    return NextResponse.json(
      { error: "Question is required" },
      { status: 400 }
    );
  }

  try {
    const [progress, dashboard, sectionProgress] = await Promise.all([
      getProgressData(user.id),
      getDashboardData(user.id),
      getAllSectionProgress(user.id),
    ]);

    // Identify weak and strong topics
    const weakTopics = progress.topicPerformance
      .filter((t) => t.total >= 5 && t.accuracy < 70)
      .map((t) => ({ name: t.name, accuracy: t.accuracy }));

    const strongTopics = progress.topicPerformance
      .filter((t) => t.total >= 5 && t.accuracy >= 85)
      .map((t) => ({ name: t.name, accuracy: t.accuracy }));

    // CPA section pass/fail summary: 3 mandatory core sections + the
    // candidate's chosen discipline section (if picked yet).
    const relevantSections = user.targetDisciplineSection
      ? [...CPA_CORE_SECTIONS, user.targetDisciplineSection]
      : CPA_CORE_SECTIONS;
    const sectionStatus = relevantSections.map((section) => {
      const entry = sectionProgress.find((s) => s.section === section);
      return {
        section,
        passed: entry?.passed ?? false,
        best_scaled_score: entry?.bestScaledScore ?? null,
        attempts_count: entry?.attemptsCount ?? 0,
      };
    });

    const studentContext = {
      display_name: user.displayName,
      target_discipline_section: user.targetDisciplineSection,
      section_status: sectionStatus,
      sections_passed: sectionStatus.filter((s) => s.passed).length,
      sections_total: sectionStatus.length,
      overall_accuracy: progress.overallStats.accuracy,
      total_questions_attempted: progress.overallStats.totalQuestions,
      streak: dashboard.streak,
      total_xp: user.totalXp,
      weak_topics: weakTopics,
      strong_topics: strongTopics,
      topic_mastery: {
        mastered: progress.topicMastery.masteredCount,
        total: progress.topicMastery.totalCount,
      },
      recent_sessions: progress.recentSessions.slice(0, 5).map((s) => ({
        subtopic: s.subtopicName,
        score: s.score,
        total_questions: s.totalQuestions,
        date: s.date,
      })),
    };

    const res = await fetch(`${AGENT_URL}/mentor-chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        history: trimHistory(history ?? []),
        student_context: studentContext,
      }),
    });

    if (!res.ok || !res.body) {
      const errorBody = await res.text().catch(() => "no body");
      console.error(
        `[agent/mentor-chat/stream] Agent returned ${res.status}:`,
        errorBody
      );
      throw new Error(`Agent service returned ${res.status}: ${errorBody}`);
    }

    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[agent/mentor-chat/stream] Error:", err);
    return NextResponse.json(
      { error: "Mentor is currently unavailable. Please try again later." },
      { status: 503 }
    );
  }
}
