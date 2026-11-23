// Admin-only queries. Every caller must have passed getAdmin() first.
import { z } from "zod";
import { adminDb, AdminInputError } from "@/lib/admin/auth";
import { BALANCE_TARGETS, ACCURACY_FLAGS } from "@/lib/admin/config";
import { BANK_SOURCES, type ProblemEditable } from "@/lib/admin/validation";
import { tbsAnswerKeySchema, tbsExhibitSchema, tbsFieldSchema } from "@/lib/tbs/schema";
import { getAccess } from "@/lib/subscription";
import { getCurrentQuestStreak } from "@/lib/db/queries/daily-quest";
import { getStreakFreezes } from "@/lib/db/queries/streak-freezes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/** Escapes LIKE wildcards in user search input. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ── Taxonomy ───────────────────────────────────────────────────────────────
export async function listSubtopicsForAdmin() {
  const { data, error } = await adminDb
    .from("subtopics")
    .select("id, name, slug, order_index, topics!inner(slug, name, subject, order_index)")
    .in("topics.subject", ["aud", "far", "reg", "bar", "isc", "tcp"]);
  if (error) throw new Error(`subtopics read failed: ${error.message}`);
  type Row = {
    id: string;
    name: string;
    slug: string;
    order_index: number;
    topics: { slug: string; name: string; subject: string; order_index: number };
  };
  return ((data ?? []) as Row[])
    .sort(
      (a, b) =>
        a.topics.subject.localeCompare(b.topics.subject) ||
        a.topics.order_index - b.topics.order_index ||
        a.order_index - b.order_index
    )
    .map((r) => ({ id: r.id, name: r.name, section: r.topics.subject, topicName: r.topics.name }));
}

async function getSubtopicSlugs(subtopicId: string) {
  const { data, error } = await adminDb
    .from("subtopics")
    .select("id, slug, topics!inner(slug, subject)")
    .eq("id", subtopicId)
    .maybeSingle();
  if (error) throw new Error(`subtopic read failed: ${error.message}`);
  return data as { id: string; slug: string; topics: { slug: string; subject: string } } | null;
}

// ── Questions ──────────────────────────────────────────────────────────────
export type QuestionFilters = {
  q?: string;
  section?: string;
  subtopicId?: string;
  difficulty?: string;
  source?: string;
  status?: string;
  page: number;
  pageSize: number;
};

export async function listQuestions(f: QuestionFilters) {
  const join = f.section ? "subtopics!inner(name, topics!inner(subject))" : "subtopics(name, topics(subject))";
  let query = adminDb
    .from("problems")
    .select(`id, source, difficulty, status, question_text, created_at, ${join}`, { count: "exact" });

  query = f.source ? query.eq("source", f.source) : query.in("source", BANK_SOURCES);
  if (f.section) query = query.eq("subtopics.topics.subject", f.section);
  if (f.subtopicId) query = query.eq("subtopic_id", f.subtopicId);
  if (f.difficulty) query = query.eq("difficulty", f.difficulty);
  if (f.status) query = query.eq("status", f.status);
  if (f.q) {
    query = isUuid(f.q) ? query.eq("id", f.q) : query.ilike("question_text", `%${likeEscape(f.q)}%`);
  }

  const from = (f.page - 1) * f.pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + f.pageSize - 1);
  if (error) throw new Error(`problems list failed: ${error.message}`);

  type Row = {
    id: string;
    source: string;
    difficulty: string;
    status: string;
    question_text: string;
    subtopics: { name: string; topics: { subject: string } | null } | null;
  };
  return {
    total: count ?? 0,
    rows: ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      source: r.source,
      difficulty: r.difficulty,
      status: r.status,
      stem: r.question_text.length > 160 ? `${r.question_text.slice(0, 160)}…` : r.question_text,
      subtopicName: r.subtopics?.name ?? null,
      section: r.subtopics?.topics?.subject ?? null,
    })),
  };
}

const PROBLEM_COLUMNS =
  "id, source, status, difficulty, difficulty_level, question_text, options, correct_option, explanation, subtopic_id, topic_slug, subtopic_slug, created_at";

export type AdminProblem = ProblemEditable & {
  id: string;
  source: string;
  difficulty_level: number;
  topic_slug: string | null;
  subtopic_slug: string | null;
  created_at: string;
};

export async function getQuestion(id: string): Promise<AdminProblem | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await adminDb
    .from("problems")
    .select(PROBLEM_COLUMNS)
    .eq("id", id)
    .in("source", BANK_SOURCES)
    .maybeSingle();
  if (error) throw new Error(`problem read failed: ${error.message}`);
  if (!data) return null;
  return { ...data, options: Array.isArray(data.options) ? data.options.map(String) : [] } as AdminProblem;
}

/** Writes a validated patch; keeps practice slugs in sync with the subtopic. */
export async function updateQuestion(id: string, patch: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...patch };
  if (typeof patch.subtopic_id === "string") {
    const sub = await getSubtopicSlugs(patch.subtopic_id);
    if (!sub) throw new AdminInputError("Unknown subtopic");
    row.subtopic_slug = sub.slug;
    row.topic_slug = sub.topics.slug;
  }
  const { error } = await adminDb.from("problems").update(row).eq("id", id);
  if (error) throw new Error(`problem update failed: ${error.message}`);
}

// ── TBS ────────────────────────────────────────────────────────────────────
export async function listTbs(f: { section?: string; status?: string; q?: string; page: number; pageSize: number }) {
  let query = adminDb
    .from("tbs_tasks")
    .select("id, section, title, difficulty, status, is_sample, est_minutes, created_at, subtopics(name)", {
      count: "exact",
    });
  if (f.section) query = query.eq("section", f.section);
  if (f.status) query = query.eq("status", f.status);
  if (f.q) query = isUuid(f.q) ? query.eq("id", f.q) : query.ilike("title", `%${likeEscape(f.q)}%`);
  const from = (f.page - 1) * f.pageSize;
  const { data, error, count } = await query
    .order("section", { ascending: true })
    .order("created_at", { ascending: true })
    .range(from, from + f.pageSize - 1);
  if (error) throw new Error(`tbs_tasks list failed: ${error.message}`);
  return {
    total: count ?? 0,
    rows: ((data ?? []) as {
      id: string;
      section: string;
      title: string;
      difficulty: string;
      status: string;
      is_sample: boolean;
      est_minutes: number;
      subtopics: { name: string } | null;
    }[]).map((r) => ({
      id: r.id,
      section: r.section,
      title: r.title,
      difficulty: r.difficulty,
      status: r.status,
      isSample: r.is_sample,
      estMinutes: r.est_minutes,
      subtopicName: r.subtopics?.name ?? null,
    })),
  };
}

const TBS_COLUMNS =
  "id, section, subtopic_id, title, difficulty, instructions, exhibits, fields, explanation, est_minutes, status, is_sample, created_at";

export type AdminTbs = {
  id: string;
  section: string;
  subtopic_id: string | null;
  title: string;
  difficulty: string;
  instructions: string;
  exhibits: unknown;
  fields: unknown;
  explanation: string;
  est_minutes: number;
  status: string;
  is_sample: boolean;
  created_at: string;
  answer_key: unknown;
};

export async function getTbsForAdmin(id: string): Promise<AdminTbs | null> {
  if (!isUuid(id)) return null;
  const [{ data, error }, { data: key, error: keyError }] = await Promise.all([
    adminDb.from("tbs_tasks").select(TBS_COLUMNS).eq("id", id).maybeSingle(),
    adminDb.from("tbs_answer_keys").select("answers").eq("tbs_id", id).maybeSingle(),
  ]);
  if (error) throw new Error(`tbs_tasks read failed: ${error.message}`);
  if (keyError) throw new Error(`tbs_answer_keys read failed: ${keyError.message}`);
  return data ? { ...data, answer_key: key?.answers ?? null } : null;
}

export const parseTbsShape = (t: Pick<AdminTbs, "exhibits" | "fields" | "answer_key">) => ({
  exhibits: z.array(tbsExhibitSchema).safeParse(t.exhibits),
  fields: z.array(tbsFieldSchema).safeParse(t.fields),
  key: tbsAnswerKeySchema.safeParse(t.answer_key),
});

export async function updateTbs(id: string, task: Record<string, unknown>, answerKey: unknown | undefined) {
  if (Object.keys(task).length) {
    const { error } = await adminDb.from("tbs_tasks").update(task).eq("id", id);
    if (error) throw new Error(`tbs_tasks update failed: ${error.message}`);
  }
  if (answerKey !== undefined) {
    const { error } = await adminDb
      .from("tbs_answer_keys")
      .upsert({ tbs_id: id, answers: answerKey }, { onConflict: "tbs_id" });
    if (error) throw new Error(`tbs_answer_keys upsert failed: ${error.message}`);
  }
}

/** Makes `id` the one approved sample of its section (clears the previous one first). */
export async function setSectionSample(section: string, id: string) {
  const { error: clearError } = await adminDb
    .from("tbs_tasks")
    .update({ is_sample: false })
    .eq("section", section)
    .eq("is_sample", true)
    .neq("id", id);
  if (clearError) throw new Error(`clear sample failed: ${clearError.message}`);
  const { error } = await adminDb.from("tbs_tasks").update({ is_sample: true }).eq("id", id);
  if (error) throw new Error(`set sample failed: ${error.message}`);
}

export async function currentSectionSample(section: string): Promise<string | null> {
  const { data, error } = await adminDb
    .from("tbs_tasks")
    .select("id")
    .eq("section", section)
    .eq("is_sample", true)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw new Error(`sample read failed: ${error.message}`);
  return data?.id ?? null;
}

// ── Balance ────────────────────────────────────────────────────────────────
type BalanceRow = {
  section: string;
  topic_name: string;
  subtopic_id: string;
  subtopic_name: string;
  kind: "mcq" | "practice" | "tbs";
  easy: number | string;
  medium: number | string;
  hard: number | string;
};

export async function getBalance() {
  const [{ data, error }, { data: acc, error: accError }] = await Promise.all([
    adminDb.rpc("admin_difficulty_balance"),
    adminDb.rpc("admin_question_accuracy", {
      p_min_attempts: ACCURACY_FLAGS.minAttempts,
      p_easy: ACCURACY_FLAGS.tooEasy,
      p_hard: ACCURACY_FLAGS.tooHard,
      p_limit: ACCURACY_FLAGS.limit,
    }),
  ]);
  if (error) throw new Error(`admin_difficulty_balance failed: ${error.message}`);
  if (accError) throw new Error(`admin_question_accuracy failed: ${accError.message}`);

  type Counts = { easy: number; medium: number; hard: number };
  const bySub = new Map<
    string,
    { section: string; topicName: string; subtopicId: string; subtopicName: string; mcq: Counts; practice: Counts; tbs: Counts; gaps: string[] }
  >();
  for (const r of (data ?? []) as BalanceRow[]) {
    const entry =
      bySub.get(r.subtopic_id) ??
      {
        section: r.section,
        topicName: r.topic_name,
        subtopicId: r.subtopic_id,
        subtopicName: r.subtopic_name,
        mcq: { easy: 0, medium: 0, hard: 0 },
        practice: { easy: 0, medium: 0, hard: 0 },
        tbs: { easy: 0, medium: 0, hard: 0 },
        gaps: [] as string[],
      };
    entry[r.kind] = { easy: Number(r.easy), medium: Number(r.medium), hard: Number(r.hard) };
    bySub.set(r.subtopic_id, entry);
  }
  const total = (c: Counts) => c.easy + c.medium + c.hard;
  const t = BALANCE_TARGETS;
  for (const e of bySub.values()) {
    for (const d of ["easy", "medium", "hard"] as const) {
      if (e.mcq[d] < t.mcq[d]) e.gaps.push(`mcq.${d}`);
    }
    if (total(e.practice) < t.practice.total) e.gaps.push("practice");
    if (total(e.tbs) < t.tbs.total) e.gaps.push("tbs");
  }

  return {
    targets: BALANCE_TARGETS,
    accuracyFlags: ACCURACY_FLAGS,
    subtopics: [...bySub.values()],
    flagged: ((acc ?? []) as {
      problem_id: string;
      source: string;
      difficulty: string;
      section: string | null;
      subtopic_name: string | null;
      attempts: number | string;
      correct: number | string;
      accuracy: number | string;
      flag: "too_easy" | "too_hard";
    }[]).map((r) => ({
      problemId: r.problem_id,
      source: r.source,
      difficulty: r.difficulty,
      section: r.section,
      subtopicName: r.subtopic_name,
      attempts: Number(r.attempts),
      correct: Number(r.correct),
      accuracy: Number(r.accuracy),
      flag: r.flag,
    })),
  };
}

// ── Users ──────────────────────────────────────────────────────────────────
export async function searchUsers(q: string) {
  const term = q.trim();
  if (!term) return [];
  let query = adminDb
    .from("users")
    .select("id, email, display_name, subscription_status, plan_type, trial_ends_at, created_at");
  if (isUuid(term)) query = query.eq("id", term);
  else if (/^user_[A-Za-z0-9]+$/.test(term)) query = query.eq("clerk_id", term);
  else query = query.ilike("email", `%${likeEscape(term)}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(25);
  if (error) throw new Error(`users search failed: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    email: string;
    display_name: string | null;
    subscription_status: string | null;
    plan_type: string | null;
    trial_ends_at: string | null;
    created_at: string;
  }[]).map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    tier: getAccess({ subscriptionStatus: u.subscription_status, trialEndsAt: u.trial_ends_at, createdAt: u.created_at }).tier,
    planType: u.plan_type ?? "free",
  }));
}

const USER_COLUMNS =
  "id, clerk_id, email, display_name, plan_type, subscription_status, subscription_end_date, stripe_customer_id, trial_started_at, trial_ends_at, created_at, updated_at, current_streak, best_streak, quest_blocked, last_missed_quest_date, is_admin";

export type AdminUserRow = {
  id: string;
  clerk_id: string;
  email: string;
  display_name: string | null;
  plan_type: string | null;
  subscription_status: string | null;
  subscription_end_date: string | null;
  stripe_customer_id: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
  current_streak: number | null;
  best_streak: number | null;
  quest_blocked: boolean;
  last_missed_quest_date: string | null;
  is_admin: boolean;
};

export async function getUserRowForAdmin(id: string): Promise<AdminUserRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await adminDb.from("users").select(USER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`users read failed: ${error.message}`);
  return data ?? null;
}

async function latest(table: string, column: string, userId: string): Promise<string | null> {
  const { data } = await adminDb
    .from(table)
    .select(column)
    .eq("user_id", userId)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.[column] as string | undefined) ?? null;
}

function stripeCustomerUrl(customerId: string | null): string | null {
  if (!customerId) return null;
  const test = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test") ? "test/" : "";
  return `https://dashboard.stripe.com/${test}customers/${encodeURIComponent(customerId)}`;
}

export async function getUserDetailForAdmin(id: string) {
  const u = await getUserRowForAdmin(id);
  if (!u) return null;
  const [streak, freezes, ...activity] = await Promise.all([
    getCurrentQuestStreak(u.id),
    getStreakFreezes(u.id),
    latest("quiz_sessions", "created_at", u.id),
    latest("daily_quests", "updated_at", u.id),
    latest("tbs_attempts", "updated_at", u.id),
    latest("cpa_section_exam_attempts", "started_at", u.id),
  ]);
  const lastActive = activity.filter((d): d is string => !!d).sort().at(-1) ?? null;
  const access = getAccess({
    subscriptionStatus: u.subscription_status,
    trialEndsAt: u.trial_ends_at,
    createdAt: u.created_at,
  });
  return {
    id: u.id,
    clerkId: u.clerk_id,
    email: u.email,
    displayName: u.display_name,
    isAdmin: u.is_admin,
    planType: u.plan_type ?? "free",
    subscriptionStatus: u.subscription_status ?? "free",
    subscriptionEndDate: u.subscription_end_date,
    tier: access.tier,
    trialStartedAt: u.trial_started_at,
    trialEndsAt: access.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft: access.daysLeft,
    stripeCustomerId: u.stripe_customer_id,
    stripeUrl: stripeCustomerUrl(u.stripe_customer_id),
    currentStreak: streak,
    bestStreak: u.best_streak ?? 0,
    questBlocked: u.quest_blocked,
    lastMissedQuestDate: u.last_missed_quest_date,
    streakFreezes: freezes,
    createdAt: u.created_at,
    lastActive,
  };
}

/** Resolves every unresolved missed quest and unblocks the user. Returns the quest ids resolved. */
export async function clearAccountabilityLock(userId: string): Promise<string[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await adminDb
    .from("daily_quests")
    .update({ reset_completed_at: new Date().toISOString(), reset_reason: "Cleared by admin" })
    .eq("user_id", userId)
    .lt("quest_date", today)
    .neq("status", "completed")
    .is("reset_completed_at", null)
    .select("id");
  if (error) throw new Error(`daily_quests reset failed: ${error.message}`);
  const { error: userError } = await adminDb.from("users").update({ quest_blocked: false }).eq("id", userId);
  if (userError) throw new Error(`users unblock failed: ${userError.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export async function setTrialEnd(userId: string, trialEndsAt: Date, trialStartedAt: string | null) {
  const { error } = await adminDb
    .from("users")
    .update({
      trial_ends_at: trialEndsAt.toISOString(),
      ...(trialStartedAt ? {} : { trial_started_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`users trial update failed: ${error.message}`);
}
