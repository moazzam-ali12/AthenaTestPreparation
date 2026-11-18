// SQL state shortcuts (instead of clicking through or waiting). Every write is scoped to an e2e account.
import { q, one, setUser, userByEmail } from "./db";
import { emailFor, type Role } from "./accounts";

export type Section = "aud" | "far" | "reg" | "bar" | "isc" | "tcp";
export type SubtopicRef = { id: string; topicSlug: string; subtopicSlug: string; section: Section };

/** Subtopics of a section in curriculum order (topic.order_index, subtopic.order_index). */
export async function subtopicsOf(section: Section): Promise<SubtopicRef[]> {
  return q<SubtopicRef>(
    `select s.id, t.slug as "topicSlug", s.slug as "subtopicSlug", t.subject as section
       from subtopics s join topics t on t.id = s.topic_id
      where t.subject = $1 order by t.order_index, s.order_index`,
    [section]
  );
}

export const quizPath = (s: SubtopicRef, n = 1) =>
  `/learning/${encodeURIComponent(s.topicSlug)}/${encodeURIComponent(s.subtopicSlug)}/quiz/${n}`;
export const quizApi = (s: SubtopicRef) =>
  `/api/learning/${encodeURIComponent(s.topicSlug)}/${encodeURIComponent(s.subtopicSlug)}?mode=quiz`;

/** Answer keys straight from the DB — the quiz payload no longer carries them. */
export async function correctOptions(problemIds: string[]): Promise<Map<string, number>> {
  const rows = await q<{ id: string; c: number }>(
    "select id, correct_option as c from problems where id = any($1::uuid[])",
    [problemIds]
  );
  return new Map(rows.map((r) => [r.id, r.c]));
}

async function uid(role: Role) {
  const u = await userByEmail(emailFor(role));
  if (!u) throw new Error(`no staging user for ${role}`);
  return u.id;
}

/** Marks subtopics as passed (100%) so the curriculum chain unlocks the next one. */
export async function passSubtopics(role: Role, subs: SubtopicRef[]) {
  const id = await uid(role);
  for (const s of subs) {
    await q(
      `insert into quiz_sessions (user_id, source, subtopic_id, score, total_questions, time_elapsed_seconds)
       values ($1, 'cpa', $2, 10, 10, 60)`,
      [id, s.id]
    );
  }
}

/**
 * Staging-only test content: no `practice` problems exist in athena, so the tutor's practice loop
 * is empty. Clones 2 of the subtopic's cpa questions as practice problems (hint marks them as e2e).
 */
/**
 * Staging-only: a custom ("My Learning") topic owned by `role`, with 2 questions cloned from
 * `from`'s cpa questions — avoids the slow LLM generation route. Returns the topic id.
 */
export async function ensureCustomTopic(role: Role, from: SubtopicRef): Promise<string> {
  const id = await uid(role);
  const title = "[e2e] custom topic";
  let topic = await one<{ id: string }>("select id from custom_topics where user_id = $1 and title = $2", [id, title]);
  if (!topic) {
    topic = (await one<{ id: string }>(
      `insert into custom_topics (user_id, title, description, learning_objectives, tips_and_tricks, common_mistakes)
       values ($1, $2, 'e2e fixture', '[]', '[]', '[]') returning id`,
      [id, title]
    ))!;
    await q(
      `insert into problems (source, custom_topic_id, order_index, difficulty, difficulty_level, question_text, options,
                             correct_option, explanation, solution_steps, hint)
       select 'custom', $2, order_index, difficulty, difficulty_level, question_text, options,
              correct_option, explanation, solution_steps, hint
         from problems where subtopic_id = $1 and source = 'cpa' order by order_index limit 2`,
      [from.id, topic.id]
    );
  }
  return topic.id;
}

export async function ensurePracticeProblems(s: SubtopicRef) {
  await q(
    `insert into problems (source, subtopic_id, order_index, difficulty, difficulty_level, question_text, options,
                           correct_option, explanation, solution_steps, hint)
     select 'practice', subtopic_id, 9000 + rn, difficulty, difficulty_level, question_text, options,
            correct_option, explanation, solution_steps, '[e2e practice fixture] ' || coalesce(hint, '')
       from (select p.*, row_number() over (order by order_index) rn from problems p
              where p.subtopic_id = $1 and p.source = 'cpa' order by order_index desc limit 2) x
      where not exists (select 1 from problems where subtopic_id = $1 and source = 'practice')`,
    [s.id]
  );
  await q(
    `update problems set topic_slug = $2, subtopic_slug = $3 where subtopic_id = $1 and source = 'practice'`,
    [s.id, s.topicSlug, s.subtopicSlug]
  );
}

export async function setTrialEndsIn(role: Role, interval: string) {
  await setUser(emailFor(role), `trial_ends_at = now() + $2::interval`, [interval]);
}

export async function setTutorUsedToday(role: Role, used: number) {
  const id = await uid(role);
  await q(
    `insert into trial_daily_usage (user_id, kind, usage_date, used)
     values ($1, 'tutor_msg', (now() at time zone 'utc')::date, $2)
     on conflict (user_id, kind, usage_date) do update set used = excluded.used`,
    [id, used]
  );
}

export async function trialUsage(role: Role) {
  const id = await uid(role);
  return q<{ section: string; kind: string; n: number }>(
    `select section, kind, count(*)::int n from trial_usage where user_id = $1 group by 1, 2`,
    [id]
  );
}

export async function userRow(role: Role) {
  return (await userByEmail(emailFor(role)))!;
}

/**
 * Puts an e2e account back to a fresh 7-day trial with no usage or attempts, so a spec can run
 * on both viewports (and be re-run). XP/streak are reset too.
 */
export async function resetToFreshTrial(role: Role) {
  const id = await uid(role);
  const del = (sql: string) => q(sql, [id]);
  await del("delete from cpa_section_exam_answers where attempt_id in (select id from cpa_section_exam_attempts where user_id = $1)");
  await del("delete from cpa_section_exam_attempts where user_id = $1");
  await del("delete from user_cpa_section_progress where user_id = $1");
  await del("delete from tbs_attempts where user_id = $1");
  await del("delete from trial_usage where user_id = $1");
  await del("delete from trial_daily_usage where user_id = $1");
  await del("delete from quiz_answers where session_id in (select id from quiz_sessions where user_id = $1)");
  await del("delete from quiz_sessions where user_id = $1");
  await del("delete from daily_quest_problems where quest_id in (select id from daily_quests where user_id = $1)");
  await del("delete from daily_quests where user_id = $1");
  await setUser(
    emailFor(role),
    `subscription_status = 'free', plan_type = 'free', trial_started_at = now(), trial_ends_at = now() + interval '7 days',
     total_xp = 0, current_streak = 0, streak_last_date = null`
  );
}

export const userId = uid;

/**
 * resetToFreshTrial plus the adaptive / quest / schedule state the suite/ specs touch, so each
 * spec starts from a brand-new learner and specs can run in any order.
 */
export async function resetLearner(role: Role) {
  await resetToFreshTrial(role);
  const id = await uid(role);
  for (const t of ["subsection_skills", "sessions", "schedules", "streak_freezes"]) {
    await q(`delete from ${t} where user_id = $1`, [id]);
  }
  await setUser(
    emailFor(role),
    `quest_blocked = false, last_missed_quest_date = null, overall_level = 1, best_streak = 0`
  );
}

/** Today's quest row (local date, as the app stores it), if any. */
export async function questOn(role: Role, daysAgo = 0) {
  return one<{ id: string; status: string; xp_earned: number; correct_count: number }>(
    "select id, status, xp_earned, correct_count from daily_quests where user_id = $1 and quest_date = $2::date",
    [await uid(role), localDaysAgo(daysAgo)]
  );
}

/** Snapshot of everything a user has built up, for the "progress survives" checks. */
export async function progressSnapshot(role: Role) {
  const id = await uid(role);
  const count = async (sql: string) => Number((await one<{ n: string }>(sql, [id]))?.n ?? 0);
  const u = (await one<{ total_xp: number; current_streak: number; best_streak: number; overall_level: number }>(
    "select total_xp, current_streak, best_streak, overall_level from users where id = $1",
    [id]
  ))!;
  return {
    ...u,
    quizSessions: await count("select count(*) n from quiz_sessions where user_id = $1"),
    quizAnswers: await count(
      "select count(*) n from quiz_answers a join quiz_sessions s on s.id = a.session_id where s.user_id = $1"
    ),
    skills: await count("select count(*) n from subsection_skills where user_id = $1"),
    tbsAttempts: await count("select count(*) n from tbs_attempts where user_id = $1"),
    examAttempts: await count("select count(*) n from cpa_section_exam_attempts where user_id = $1"),
    trialUsage: await count("select count(*) n from trial_usage where user_id = $1"),
  };
}

/**
 * Marks every unanswered question of a quest as answered, the first `correct` (in order) right and
 * the rest wrong, straight in SQL. Faster than the answer API (~5 s per call on dev) for specs that
 * test what happens after answering; the answer path itself is covered by quest.spec's flow test.
 * Returns the XP /api/daily-quest/complete should award (same difficulty tiers as the route).
 */
export async function answerQuestInDb(questId: string, correct: number) {
  const rows = await q<{ id: string; is_correct: boolean | null; difficulty_level: number }>(
    "select id, is_correct, difficulty_level from daily_quest_problems where quest_id = $1 order by order_index",
    [questId]
  );
  let n = 0;
  for (const r of rows.filter((r) => r.is_correct === null)) {
    await q(
      "update daily_quest_problems set is_correct = $2, selected_option = 0, response_time_ms = 3000, answered_at = now() where id = $1",
      [r.id, n++ < correct]
    );
  }
  const answered = await q<{ is_correct: boolean; difficulty_level: number }>(
    "select is_correct, difficulty_level from daily_quest_problems where quest_id = $1", [questId]
  );
  const xpFor = (dl: number) => (dl >= 9 ? 40 : dl >= 7 ? 20 : dl >= 4 ? 10 : 5);
  return {
    correctCount: answered.filter((a) => a.is_correct).length,
    xp: answered.filter((a) => a.is_correct).reduce((s, a) => s + xpFor(a.difficulty_level), 0),
  };
}

/** Local calendar day N days ago, as the app (same machine) stores quest_date. */
export function localDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Replaces the account's daily-quest history with completed quests on each day from
 * `fromDaysAgo` down to `toDaysAgo` (inclusive), and syncs current/best streak to match.
 */
export async function seedQuestStreak(role: Role, fromDaysAgo: number, toDaysAgo: number) {
  const id = await uid(role);
  await q("delete from daily_quest_problems where quest_id in (select id from daily_quests where user_id = $1)", [id]);
  await q("delete from daily_quests where user_id = $1", [id]);
  const days: string[] = [];
  for (let n = fromDaysAgo; n >= toDaysAgo; n--) days.push(localDaysAgo(n));
  for (const day of days) {
    await q(
      `insert into daily_quests (user_id, quest_date, status, score, total_questions, correct_count, xp_earned)
       values ($1, $2::date, 'completed', 10, 10, 8, 50)`,
      [id, day]
    );
  }
  await q(
    "update users set current_streak = $2, best_streak = greatest(coalesce(best_streak, 0), $2), streak_last_date = $3::date where id = $1",
    [id, days.length, days[days.length - 1] ?? null]
  );
  return days;
}
