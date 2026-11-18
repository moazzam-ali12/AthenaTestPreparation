// Accountability: missed quest -> quest locked -> reason + recommit -> unlocked.
// Schedule change: new slots apply from today on; past sessions are kept.
import { test, expect, api, open } from "../lib/fixtures";
import { closeDb, q, one } from "../lib/db";
import { localDaysAgo, resetLearner, userId } from "../lib/state";

const ROLE = "quest" as const;
test.describe.configure({ mode: "serial" });
test.beforeEach(() => resetLearner(ROLE));
test.afterAll(closeDb);

async function seedMissedQuest(daysAgo: number) {
  const [row] = await q<{ id: string }>(
    "insert into daily_quests (user_id, quest_date, status) values ($1, $2::date, 'pending') returning id",
    [await userId(ROLE), localDaysAgo(daysAgo)]
  );
  return row.id;
}

test("missed quest locks the quest until reset + recommit", { tag: "@smoke" }, async ({ as }) => {
  const missedId = await seedMissedQuest(2);
  const page = await as(ROLE);
  const check = await api(page, "GET", "/api/daily-quest/accountability");
  expect(check.body).toMatchObject({ isBlocked: true, missedQuestId: missedId, missedDate: localDaysAgo(2) });
  expect((await one<{ quest_blocked: boolean }>("select quest_blocked from users where id = $1", [await userId(ROLE)]))!.quest_blocked).toBe(true);

  await open(page, "/quest");
  const modal = page.getByRole("heading", { name: "Missed Session" });
  await expect(modal).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByRole("button", { name: "I got too busy" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Recommit to Your Goal" })).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().includes("/api/daily-quest/accountability") && r.request().method() === "POST");
  await page.getByRole("button", { name: "I Recommit" }).click();
  expect((await saved).status()).toBe(200);

  const row = (await one<{ reset_reason: string; reset_completed_at: Date | null }>(
    "select reset_reason, reset_completed_at from daily_quests where id = $1", [missedId]
  ))!;
  expect(row.reset_reason).toBe("I got too busy");
  expect(row.reset_completed_at).not.toBeNull();
  expect((await api(page, "GET", "/api/daily-quest/accountability")).body.isBlocked).toBe(false);
  await open(page, "/quest");
  await expect(page).toHaveURL(/\/quest\/\d+$/);
  await expect(modal).toHaveCount(0);
});

test("a completed or frozen day is not a miss", async ({ as }) => {
  const id = await userId(ROLE);
  await q("insert into daily_quests (user_id, quest_date, status) values ($1, $2::date, 'completed')", [id, localDaysAgo(1)]);
  await q("insert into daily_quests (user_id, quest_date, status) values ($1, $2::date, 'pending')", [id, localDaysAgo(3)]);
  await q("insert into streak_freezes (user_id, start_date, end_date) values ($1, $2::date, $2::date)", [id, localDaysAgo(3)]);
  const page = await as(ROLE);
  expect((await api(page, "GET", "/api/daily-quest/accountability")).body.isBlocked).toBe(false);
});

const BOGUS_QUEST = "00000000-0000-0000-0000-000000000000";

test("recommit for a quest that isn't yours doesn't unlock", async ({ as }) => {
  await seedMissedQuest(2);
  const page = await as(ROLE);
  expect((await api(page, "GET", "/api/daily-quest/accountability")).body.isBlocked).toBe(true);
  await api(page, "POST", "/api/daily-quest/accountability", { questId: BOGUS_QUEST, reason: "Other" });
  expect((await api(page, "GET", "/api/daily-quest/accountability")).body.isBlocked, "still locked").toBe(true);
  await open(page, "/quest");
  await expect(page.getByRole("heading", { name: "Missed Session" })).toBeVisible();
});

test("recommit API rejects an unknown quest id", async ({ as }) => {
  // KNOWN BUG (reported): POST /api/daily-quest/accountability returns 200 and clears
  // users.quest_blocked without checking the quest exists / is the caller's. The next GET re-locks,
  // so impact is low. Remove test.fail() once the route returns 4xx.
  test.fail();
  await seedMissedQuest(2);
  const page = await as(ROLE);
  await api(page, "GET", "/api/daily-quest/accountability");
  const r = await api(page, "POST", "/api/daily-quest/accountability", { questId: BOGUS_QUEST, reason: "Other" });
  expect(r.status, "unknown quest id rejected").toBeGreaterThanOrEqual(400);
  expect((await one<{ quest_blocked: boolean }>("select quest_blocked from users where id = $1", [await userId(ROLE)]))!.quest_blocked).toBe(true);
});

test("schedule change applies forward only: past sessions kept, new ones from today", async ({ as }) => {
  // KNOWN BUG (reported): generateSessionDates (src/lib/schedule-utils.ts) formats local midnight
  // with toISOString(), so a server east of UTC dates every session one day early. The app server
  // runs on this machine, so the local offset tells us whether the bug shows. Vercel runs UTC.
  test.fail(new Date().getTimezoneOffset() < 0, "sessions dated a day early when the server is east of UTC");
  const page = await as(ROLE);
  const slot = (dayOfWeek: string) => ({ dayOfWeek, startTime: "18:00", endTime: "19:00" });
  const first = await api(page, "POST", "/api/schedule", { slots: [slot("monday"), slot("wednesday")] });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const id = await userId(ROLE);
  // A session that already happened under the old schedule.
  const [sched] = await q<{ id: string }>("select id from schedules where user_id = $1 limit 1", [id]);
  const [past] = await q<{ id: string }>(
    "insert into sessions (user_id, schedule_id, scheduled_date, status) values ($1, $2, $3::date, 'completed') returning id",
    [id, sched.id, localDaysAgo(5)]
  );

  const second = await api(page, "POST", "/api/schedule", { slots: [slot("tuesday")] });
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  const sessions = await q<{ id: string; d: string; dow: number }>(
    "select id, scheduled_date::text d, extract(dow from scheduled_date)::int dow from sessions where user_id = $1 order by scheduled_date",
    [id]
  );
  const future = sessions.filter((s) => s.d >= localDaysAgo(0));
  expect(future.length, "new sessions generated").toBeGreaterThan(0);
  expect(future.every((s) => s.dow === 2), `future sessions all on Tuesday: ${future.map((s) => s.d)}`).toBe(true);
  expect(sessions.some((s) => s.id === past.id), "past (completed) session kept after the schedule change").toBe(true);
});
