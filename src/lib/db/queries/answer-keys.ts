import { supabase } from "@/lib/supabase/client";

export type AnswerKey = {
  correctOption: number;
  difficultyLevel: number;
  subtopicId: string | null;
};

/**
 * Server-side answer keys for grading. Correctness and difficulty must come
 * from here, never from the request body — otherwise a client can report
 * "correct, difficulty 10" to farm XP and skill levels.
 */
export async function getAnswerKeys(problemIds: string[]): Promise<Map<string, AnswerKey>> {
  if (problemIds.length === 0) return new Map();

  const { data } = (await (supabase as any)
    .from("problems")
    .select("id, correct_option, difficulty_level, subtopic_id")
    .in("id", problemIds)) as {
    data: { id: string; correct_option: number; difficulty_level: number | null; subtopic_id: string | null }[] | null;
  };

  return new Map(
    (data ?? []).map((p) => [
      p.id,
      {
        correctOption: p.correct_option,
        difficultyLevel: p.difficulty_level ?? 5,
        subtopicId: p.subtopic_id,
      },
    ])
  );
}

/**
 * Everything that gives an answer away: the key, the worked solution and the
 * hints (option hints list every wrong option, so they reveal the key too).
 * Never part of an in-progress question payload — only returned for one
 * question after the user has answered it.
 */
export type AnswerReveal = {
  correctOption: number;
  explanation: string;
  solutionSteps: { step: number; instruction: string; math: string }[];
  hint: string;
  detailedHint?: string;
  optionHints: { optionIndex: number; misconception: string; hint: string }[];
};

export async function getAnswerReveals(problemIds: string[]): Promise<Map<string, AnswerReveal & AnswerKey>> {
  if (problemIds.length === 0) return new Map();
  const { data } = (await (supabase as any)
    .from("problems")
    .select("id, correct_option, difficulty_level, subtopic_id, explanation, solution_steps, hint, detailed_hint, option_hints")
    .in("id", problemIds)) as { data: any[] | null };
  return new Map(
    (data ?? []).map((p) => [
      p.id as string,
      {
        correctOption: p.correct_option,
        difficultyLevel: p.difficulty_level ?? 5,
        subtopicId: p.subtopic_id,
        explanation: p.explanation ?? "",
        solutionSteps: (p.solution_steps ?? []).map((s: any) => ({ ...s, math: s.math ?? "" })),
        hint: p.hint ?? "",
        detailedHint: p.detailed_hint ?? undefined,
        optionHints: p.option_hints ?? [],
      },
    ])
  );
}

export async function getAnswerReveal(problemId: string): Promise<(AnswerReveal & AnswerKey) | null> {
  return (await getAnswerReveals([problemId])).get(problemId) ?? null;
}

/** Strips the grading-only fields, leaving what the client may see post-answer. */
export function toClientReveal({ difficultyLevel: _d, subtopicId: _s, ...reveal }: AnswerReveal & AnswerKey): AnswerReveal {
  return reveal;
}
