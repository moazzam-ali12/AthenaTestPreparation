import { supabase } from "@/lib/supabase/client";
import type {
  DailyQuest,
  DailyQuestProblem,
  DailyQuestProblemWithDetails,
  QuestBucket,
} from "@/types/adaptive";

/** Formats a Date as the local calendar day (YYYY-MM-DD), avoiding the UTC-shift
 * that `toISOString().split("T")[0]` introduces for timezones ahead of UTC. */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapQuest(row: Record<string, unknown>): DailyQuest {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    questDate: row.quest_date as string,
    status: row.status as DailyQuest["status"],
    score: row.score as number,
    totalQuestions: row.total_questions as number,
    correctCount: row.correct_count as number,
    xpEarned: row.xp_earned as number,
    timeElapsedSeconds: row.time_elapsed_seconds as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapQuestProblem(row: Record<string, unknown>): DailyQuestProblem {
  return {
    id: row.id as string,
    questId: row.quest_id as string,
    problemId: row.problem_id as string,
    subtopicId: row.subtopic_id as string,
    orderIndex: row.order_index as number,
    bucket: row.bucket as QuestBucket,
    difficultyLevel: row.difficulty_level as number,
    selectedOption: row.selected_option as number | null,
    isCorrect: row.is_correct as boolean | null,
    responseTimeMs: row.response_time_ms as number | null,
    answeredAt: row.answered_at as string | null,
  };
}

export async function getTodaysQuest(
  userId: string
): Promise<{ quest: DailyQuest; problems: DailyQuestProblem[] } | null> {
  const today = new Date().toISOString().split("T")[0];

  const { data: quest } = await (supabase as any)
    .from("daily_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("quest_date", today)
    .limit(1)
    .single();

  if (!quest) return null;

  const { data: problems } = await (supabase as any)
    .from("daily_quest_problems")
    .select("*")
    .eq("quest_id", quest.id)
    .order("order_index", { ascending: true });

  return {
    quest: mapQuest(quest),
    problems: (problems ?? []).map(mapQuestProblem),
  };
}

export async function getTodaysQuestWithDetails(
  userId: string
): Promise<{
  quest: DailyQuest;
  problems: DailyQuestProblemWithDetails[];
} | null> {
  const today = new Date().toISOString().split("T")[0];

  const { data: quest } = await (supabase as any)
    .from("daily_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("quest_date", today)
    .limit(1)
    .single();

  if (!quest) return null;

  const { data: problems } = await (supabase as any)
    .from("daily_quest_problems")
    .select(
      `*, problems!inner(question_text, options, correct_option, explanation, solution_steps, hint, detailed_hint, concept_tags, option_hints), subtopics!inner(name, topics!inner(name))`
    )
    .eq("quest_id", quest.id)
    .order("order_index", { ascending: true });

  const mapped: DailyQuestProblemWithDetails[] = (problems ?? []).map(
    (row: any) => {
      const problem = row.problems as Record<string, unknown>;
      const subtopic = row.subtopics as Record<string, unknown>;
      const topic = (subtopic?.topics ?? {}) as Record<string, unknown>;

      return {
        ...mapQuestProblem(row),
        questionText: problem.question_text as string,
        options: problem.options as { id: number; text: string }[],
        correctOption: problem.correct_option as number,
        explanation: problem.explanation as string,
        solutionSteps: (problem.solution_steps ?? []) as {
          step: number;
          instruction: string;
          math?: string;
        }[],
        hint: (problem.hint ?? "") as string,
        detailedHint: (problem.detailed_hint ?? "") as string,
        conceptTags: (problem.concept_tags ?? []) as string[],
        optionHints: (problem.option_hints ?? []) as {
          optionIndex: number;
          misconception: string;
          hint: string;
        }[],
        subtopicName: subtopic.name as string,
        topicName: topic.name as string,
      };
    }
  );

  return { quest: mapQuest(quest), problems: mapped };
}

export async function createDailyQuest(
  userId: string,
  problems: {
    problemId: string;
    subtopicId: string;
    orderIndex: number;
    bucket: QuestBucket;
    difficultyLevel: number;
  }[]
): Promise<{ quest: DailyQuest; problems: DailyQuestProblem[] }> {
  const today = new Date().toISOString().split("T")[0];

  const { data: quest, error: questError } = await (supabase as any)
    .from("daily_quests")
    .insert({
      user_id: userId,
      quest_date: today,
      total_questions: problems.length,
    })
    .select()
    .single();

  if (questError || !quest) {
    throw new Error(questError?.message ?? "Failed to create daily quest");
  }

  const problemRows = problems.map((p) => ({
    quest_id: quest.id,
    problem_id: p.problemId,
    subtopic_id: p.subtopicId,
    order_index: p.orderIndex,
    bucket: p.bucket,
    difficulty_level: p.difficultyLevel,
  }));

  const { data: insertedProblems, error: problemsError } = await (supabase as any)
    .from("daily_quest_problems")
    .insert(problemRows)
    .select();

  if (problemsError) throw new Error(problemsError.message);

  return {
    quest: mapQuest(quest),
    problems: (insertedProblems ?? []).map(mapQuestProblem),
  };
}

export async function answerDailyQuestProblem(
  questProblemId: string,
  selectedOption: number,
  isCorrect: boolean,
  responseTimeMs: number
): Promise<DailyQuestProblem> {
  const { data, error } = await (supabase as any)
    .from("daily_quest_problems")
    .update({
      selected_option: selectedOption,
      is_correct: isCorrect,
      response_time_ms: responseTimeMs,
      answered_at: new Date().toISOString(),
    })
    .eq("id", questProblemId)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to record answer");
  return mapQuestProblem(data);
}

export async function completeDailyQuest(
  questId: string,
  stats: {
    score: number;
    correctCount: number;
    xpEarned: number;
    timeElapsedSeconds: number;
  }
): Promise<DailyQuest> {
  const { data, error } = await (supabase as any)
    .from("daily_quests")
    .update({
      status: "completed",
      score: stats.score,
      correct_count: stats.correctCount,
      xp_earned: stats.xpEarned,
      time_elapsed_seconds: stats.timeElapsedSeconds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", questId)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to complete quest");
  return mapQuest(data);
}

export async function updateQuestStatus(
  questId: string,
  status: "in_progress" | "completed"
): Promise<void> {
  const { error } = await (supabase as any)
    .from("daily_quests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", questId);

  if (error) throw new Error(error.message);
}

export async function getQuestHistory(
  userId: string,
  limit: number = 10
): Promise<DailyQuest[]> {
  const { data } = await (supabase as any)
    .from("daily_quests")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("quest_date", { ascending: false })
    .limit(limit);

  return (data ?? []).map(mapQuest);
}

/** Current consecutive-day streak of completed daily quests, ending today or yesterday. */
export async function getCurrentQuestStreak(userId: string): Promise<number> {
  const { data } = await supabase
    .from("daily_quests")
    .select("quest_date")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("quest_date", { ascending: false });

  const questHistory = (data ?? []) as { quest_date: string }[];
  if (questHistory.length === 0) return 0;

  const today = new Date(getLocalDateString());
  const mostRecent = new Date(questHistory[0].quest_date);
  const daysSinceLast = Math.floor(
    (today.getTime() - mostRecent.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceLast > 1) return 0;

  let streak = 1;
  for (let i = 1; i < questHistory.length; i++) {
    const curr = new Date(questHistory[i].quest_date);
    const prev = new Date(questHistory[i - 1].quest_date);
    const diffDays = Math.round(
      (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
