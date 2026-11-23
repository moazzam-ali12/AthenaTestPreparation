// Notifications: dry-run assertions for each streak-alert rule, in both streak sources.
// Nothing is sent: ?dryRun=1 only returns the plan. Covers the legacy streak-alerts route and the
// 15-minute scheduler (/api/cron/notifications) that replaces it. daily-reminders has no dry run.
import { test, expect } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { env, BASE_URL } from "../lib/env";
import { localDaysAgo, resetLearner, seedQuestStreak, setTrialEndsIn, userId } from "../lib/state";

const ROLE = "notify" as const;
type PlanRow = { userId: string; streak: number; wouldEmail: boolean; skipReason?: string };

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "API-only, runs once"));
test.beforeAll(async ({}, info) => {
  if (info.project.name !== "desktop") return;
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET not set in .env.staging");
  await resetLearner(ROLE);
});
test.afterAll(closeDb);

async function planFor(source: "computed" | "stored"): Promise<PlanRow | undefined> {
  const r = await fetch(`${BASE_URL}/api/cron/streak-alerts?dryRun=1&source=${source}`, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.dryRun, "dry run sends nothing").toBe(true);
  expect(body.sent).toBe(0);
  const id = await userId(ROLE);
  return (body.plan as PlanRow[]).find((p) => p.userId === id);
}

test("cron rejects calls without the secret", { tag: "@smoke" }, async () => {
  for (const path of ["/api/cron/streak-alerts?dryRun=1", "/api/cron/daily-reminders"]) {
    expect((await fetch(`${BASE_URL}${path}`)).status, path).toBe(401);
  }
});

test("streak alert rules (dry run)", async () => {
  // Rule 1: quest done yesterday, not today, has access -> alert with the current streak.
  await seedQuestStreak(ROLE, 3, 1);
  for (const source of ["computed", "stored"] as const) {
    expect(await planFor(source), `${source}: at risk`).toMatchObject({ streak: 3, wouldEmail: true });
  }

  // Rule 2: already done today -> streak safe, not planned.
  const id = await userId(ROLE);
  await q(
    `insert into daily_quests (user_id, quest_date, status, score, total_questions, correct_count, xp_earned)
     values ($1, $2::date, 'completed', 10, 10, 8, 50)`,
    [id, localDaysAgo(0)]
  );
  await q("update users set current_streak = 4, streak_last_date = $2::date where id = $1", [id, localDaysAgo(0)]);
  for (const source of ["computed", "stored"] as const) {
    expect(await planFor(source), `${source}: done today`).toBeUndefined();
  }

  // Rule 3: expired (locked out) -> planned but no email.
  await seedQuestStreak(ROLE, 3, 1);
  await setTrialEndsIn(ROLE, "-1 hour");
  for (const source of ["computed", "stored"] as const) {
    expect(await planFor(source), `${source}: expired`).toMatchObject({ wouldEmail: false, skipReason: "expired" });
  }
  await resetLearner(ROLE);
});

// ---------------------------------------------------------------------------
// 15-minute scheduler (/api/cron/notifications): `?dryRun=1&now=<ISO>` plans that simulated
// instant without sending or logging. The account is put in UTC with a 12:00 slot every day;
// D is next Tuesday (no weekly summary), so every trigger is a fixed UTC instant.

type Planned = { userId: string; type: string; channel: string };
const DAY_MS = 86_400_000;
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const D = (() => {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
})();
/** ISO instant `dayOffset` days from D at HH:MM UTC. */
const at = (dayOffset: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(D + dayOffset * DAY_MS + (h * 60 + m) * 60_000).toISOString();
};

/** "type:channel" entries planned for the account at a simulated instant. */
async function scheduled(now: string): Promise<string[]> {
  const r = await fetch(`${BASE_URL}/api/cron/notifications?dryRun=1&now=${encodeURIComponent(now)}`, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  expect(r.status, `scheduler @ ${now}`).toBe(200);
  const body = await r.json();
  expect(body.dryRun, "dry run sends nothing").toBe(true);
  const id = await userId(ROLE);
  return (body.plan as Planned[]).filter((p) => p.userId === id).map((p) => `${p.type}:${p.channel}`).sort();
}

/** Completed quest on D+dayOffset, finished at HH:MM UTC (completion instant = updated_at). */
async function completedQuest(dayOffset: number, hhmm: string) {
  const ts = at(dayOffset, hhmm);
  await q(
    `insert into daily_quests (user_id, quest_date, status, score, total_questions, correct_count, xp_earned, updated_at)
     values ($1, $2::date, 'completed', 10, 10, 8, 50, $3)`,
    [await userId(ROLE), ts.slice(0, 10), ts]
  );
}

test.describe("scheduler dry run", () => {
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== "desktop") return;
    await resetLearner(ROLE);
    const id = await userId(ROLE);
    await q("delete from notification_log where user_id = $1", [id]);
    await q("delete from push_subscriptions where user_id = $1", [id]);
    // Trial covers every simulated instant; email only (no push), all types on.
    await q(
      `update users set timezone = 'UTC', notification_settings = '{}'::jsonb,
         trial_ends_at = now() + interval '30 days' where id = $1`,
      [id]
    );
    for (const day of DAYS) {
      await q("insert into schedules (user_id, day_of_week, start_time, end_time) values ($1, $2, '12:00', '13:00')", [id, day]);
    }
  });
  test.afterAll(async ({}, info) => {
    if (info.project.name !== "desktop") return;
    await resetLearner(ROLE);
    await q("update users set timezone = 'America/New_York' where id = $1", [await userId(ROLE)]);
  });

  test("window rules: available at study time, +4h incomplete, close−1h final, close missed", { tag: "@smoke" }, async () => {
    expect(await scheduled(at(0, "11:50")), "before study time").toEqual([]);
    expect(await scheduled(at(0, "12:05"))).toContain("quest_available:email");
    expect(await scheduled(at(0, "16:05"))).toContain("incomplete_reminder:email");
    expect(await scheduled(at(1, "11:05"))).toContain("final_reminder:email");
    expect(await scheduled(at(1, "12:05"))).toContain("missed_quest:email");
  });

  test("a quest done today silences that window's reminders", async () => {
    await completedQuest(0, "13:00");
    expect(await scheduled(at(0, "16:05"))).not.toContain("incomplete_reminder:email");
    expect(await scheduled(at(1, "11:05"))).not.toContain("final_reminder:email");
    // The next day's window still opens.
    expect(await scheduled(at(1, "12:05"))).toEqual(["quest_available:email"]);
  });

  test("streak at risk at 20:00 when yesterday done and today not", async () => {
    await completedQuest(-1, "13:00");
    expect(await scheduled(at(0, "20:05"))).toContain("streak_at_risk:email");
    await completedQuest(0, "19:00");
    expect(await scheduled(at(0, "20:05"))).not.toContain("streak_at_risk:email");
  });

  test("weekly summary on Sunday at study time", async () => {
    await completedQuest(-1, "13:00");
    expect(await scheduled(at(5, "12:05"))).toContain("weekly_summary:email"); // D+5 = Sunday
    expect(await scheduled(at(4, "12:05"))).not.toContain("weekly_summary:email"); // Saturday
  });

  test("quiet hours drop nudges; opt-outs and expired users get nothing", async () => {
    const id = await userId(ROLE);
    await q("update schedules set start_time = '23:00', end_time = '23:30' where user_id = $1", [id]);
    expect(await scheduled(at(0, "23:05")), "quest_available in quiet hours is dropped").not.toContain("quest_available:email");
    await q("update schedules set start_time = '12:00', end_time = '13:00' where user_id = $1", [id]);

    await q(`update users set notification_settings = '{"quest_available":{"email":false}}'::jsonb where id = $1`, [id]);
    // (12:05 also closes yesterday's window, so missed_quest is still planned.)
    const optedOut = await scheduled(at(0, "12:05"));
    expect(optedOut, "opted out of quest_available email").not.toContain("quest_available:email");
    expect(optedOut, "other types unaffected").toContain("missed_quest:email");

    await q("update users set notification_settings = '{}'::jsonb, trial_ends_at = now() - interval '1 day' where id = $1", [id]);
    expect(await scheduled(at(0, "12:05")), "expired").toEqual([]);
  });
});
