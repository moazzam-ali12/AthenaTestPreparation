// Daily quest: generation (20 questions, 60/30/10 mix), sequential UI flow, completion, XP, streak.
import { test, expect, api, open } from "../lib/fixtures";
import { closeDb, q } from "../lib/db";
import { answerQuestInDb, correctOptions, questOn, resetLearner, seedQuestStreak, userId, userRow } from "../lib/state";
import { answerOption, todaysQuest } from "../lib/flows";

const ROLE = "quest" as const;
test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetLearner(ROLE));
test.afterAll(closeDb);

test("quest generated: 20 unique questions, 60/30/10 weak/mid/stretch", { tag: "@smoke" }, async ({ as, leaks }) => {
  const page = await as(ROLE);
  const { quest, problems } = await todaysQuest(page);
  expect(quest, "quest generated for today").toBeTruthy();
  expect(problems).toHaveLength(20);
  expect(new Set(problems!.map((p) => p.problemId)).size, "no repeated question").toBe(20);
  const rows = await q<{ bucket: string; n: number }>(
    "select bucket, count(*)::int n from daily_quest_problems where quest_id = $1 group by 1",
    [quest!.id]
  );
  const n = Object.fromEntries(rows.map((r) => [r.bucket, r.n])) as Record<string, number>;
  // 12/6/2 ±1; with too few open subtopics for a stretch bucket its 2 roll into mid (12/8/0).
  expect(Math.abs((n.weak ?? 0) - 12), JSON.stringify(n)).toBeLessThanOrEqual(1);
  expect(Math.abs((n.mid ?? 0) + (n.stretch ?? 0) - 8), JSON.stringify(n)).toBeLessThanOrEqual(1);
  expect(n.stretch ?? 0, JSON.stringify(n)).toBeLessThanOrEqual(3);
  expect(leaks, "no answer keys sent before answering").toEqual([]);
  // A second GET doesn't create a second quest.
  await todaysQuest(page);
  expect((await q("select id from daily_quests where user_id = $1 and quest_date = current_date", [await userId(ROLE)])).length).toBeLessThanOrEqual(1);
});

test("sequential flow: correct answer advances, reload resumes at the first unanswered", async ({ as }) => {
  const page = await as(ROLE);
  const { problems } = await todaysQuest(page);
  const answered = problems!.filter((p) => p.isCorrect !== null).length;
  await open(page, "/quest");
  await expect(page).toHaveURL(new RegExp(`/quest/${answered + 1}$`));
  const p = problems![answered];
  const key = (await correctOptions([p.problemId])).get(p.problemId)!;
  const graded = page.waitForResponse((r) => r.url().includes("/api/daily-quest/answer"));
  await (await answerOption(page, key, p.options.length)).click();
  expect((await (await graded).json()).isCorrect).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/quest/${answered + 2}$`));
  await open(page, "/quest");
  await expect(page).toHaveURL(new RegExp(`/quest/${answered + 2}$`));
});

test("completion: XP added once, streak continues from yesterday", { tag: "@smoke" }, async ({ as }) => {
  // Yesterday completed -> today's completion makes it a 2-day streak.
  await seedQuestStreak(ROLE, 1, 1);
  const page = await as(ROLE);
  const { quest } = await todaysQuest(page);
  const expected = await answerQuestInDb(quest!.id, 10);
  const xpBefore = (await q<{ total_xp: number }>("select total_xp from users where id = $1", [await userId(ROLE)]))[0].total_xp;

  const done = await api(page, "POST", "/api/daily-quest/complete", { questId: quest!.id, timeElapsedSeconds: 600 });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBe(200);
  const row = (await questOn(ROLE))!;
  expect(row.status).toBe("completed");
  expect(row.correct_count).toBe(expected.correctCount);
  expect(row.xp_earned, "XP = sum of difficulty-tier XP of correct answers").toBe(expected.xp);
  expect(done.body.xpEarned).toBe(row.xp_earned);
  expect(done.body.streak).toBe(2);
  const u = await userRow(ROLE);
  expect((u as any).total_xp).toBe(xpBefore + row.xp_earned);
  expect((u as any).current_streak).toBe(2);

  // Dashboard reflects it.
  await open(page, "/dashboard");
  await expect(page.getByText(/^Day 2$/).first()).toBeVisible();
});

test("completing the same quest twice doesn't add XP twice", async ({ as }) => {
  const page = await as(ROLE);
  const quest = (await questOn(ROLE))!;
  test.skip(quest?.status !== "completed", "needs the completed quest from the previous test");
  // KNOWN BUG (reported): /api/daily-quest/complete isn't idempotent; each repeat call re-adds
  // the quest's XP to users.total_xp. Remove test.fail() once fixed.
  test.fail();
  const before = (await userRow(ROLE)) as any;
  const again = await api(page, "POST", "/api/daily-quest/complete", { questId: quest.id, timeElapsedSeconds: 600 });
  expect([200, 409]).toContain(again.status);
  const after = (await userRow(ROLE)) as any;
  expect(after.total_xp, "total XP unchanged by a repeat completion").toBe(before.total_xp);
});

test("can't complete another user's quest", async ({ as }) => {
  const otherId = await userId("notify");
  const [other] = await q<{ id: string }>(
    `insert into daily_quests (user_id, quest_date, status) values ($1, current_date - 30, 'pending')
     on conflict do nothing returning id`,
    [otherId]
  );
  test.skip(!other, "fixture quest already exists");
  // KNOWN BUG (reported): /api/daily-quest/complete doesn't check the quest belongs to the caller;
  // it completes it and credits the caller XP/streak. Remove test.fail() once fixed.
  test.fail();
  try {
    const page = await as(ROLE);
    const r = await api(page, "POST", "/api/daily-quest/complete", { questId: other.id, timeElapsedSeconds: 1 });
    expect(r.status, "foreign quest rejected").toBeGreaterThanOrEqual(400);
    const [row] = await q<{ status: string }>("select status from daily_quests where id = $1", [other.id]);
    expect(row.status, "foreign quest untouched").toBe("pending");
  } finally {
    await q("delete from daily_quests where id = $1", [other.id]);
  }
});
