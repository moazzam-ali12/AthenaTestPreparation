import { test } from "node:test";
import assert from "node:assert/strict";
import { logKey, runNotificationTick, type LogRow, type NotificationStore, type PushSub, type Senders, type UserRow } from "./scheduler";
import { notifyQuestComplete, type QuestCompleteContext } from "./events";
import type { QuestRecord, ScheduleSlot } from "./rules";

// ---- in-memory fakes (no Supabase, no Resend, no web push) -------------------

class MemoryLog {
  rows = new Map<string, LogRow>();
  claim(rows: LogRow[]) {
    const inserted = new Set<string>();
    for (const r of rows) {
      const k = logKey(r);
      if (this.rows.has(k)) continue; // ON CONFLICT DO NOTHING
      this.rows.set(k, r);
      inserted.add(k);
    }
    return inserted;
  }
}

function memoryStore(
  users: UserRow[],
  data: { slots?: Record<string, ScheduleSlot[]>; quests?: Record<string, QuestRecord[]>; push?: string[]; history?: Record<string, string[]> },
  log = new MemoryLog()
) {
  const calls = { users: 0, schedules: 0, quests: 0, push: 0, streak: 0 };
  const pick = <T>(src: Record<string, T[]> | undefined, ids: string[]) =>
    new Map(ids.filter((id) => src?.[id]).map((id) => [id, src![id]]));
  const store: NotificationStore = {
    async loadUsers(from, size) {
      calls.users++;
      return [...users].sort((a, b) => a.id.localeCompare(b.id)).slice(from, from + size);
    },
    async loadSchedules(ids) {
      calls.schedules++;
      return pick(data.slots, ids);
    },
    async loadQuests(ids, since) {
      calls.quests++;
      const m = pick(data.quests, ids);
      for (const [k, v] of m) m.set(k, v.filter((q) => q.completedAt >= since));
      return m;
    },
    async loadPushSubs(ids) {
      calls.push++;
      const sub: PushSub = { endpoint: "https://push.test/x", p256dh: "k", auth: "a" };
      return new Map(ids.filter((id) => data.push?.includes(id)).map((id) => [id, [sub]]));
    },
    async loadStreakInputs(ids) {
      calls.streak++;
      return { datesByUser: pick(data.history, ids), freezesByUser: new Map() };
    },
    async findLogged(rows) {
      return new Set(rows.map(logKey).filter((k) => log.rows.has(k)));
    },
    async claim(rows) {
      return log.claim(rows);
    },
  };
  return { store, log, calls };
}

function mockSenders() {
  const sent: { channel: "email" | "push"; to: string; subject: string }[] = [];
  const senders: Senders = {
    async email(to, subject) {
      sent.push({ channel: "email", to, subject });
    },
    async push(userId, _subs, payload) {
      sent.push({ channel: "push", to: userId, subject: payload.title + " | " + payload.body });
    },
  };
  return { senders, sent };
}

const user = (id: string, timezone: string, over: Partial<UserRow> = {}): UserRow => ({
  id,
  email: `${id}@example.test`,
  displayName: id,
  timezone,
  subscriptionStatus: "active",
  trialEndsAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  settings: {},
  ...over,
});
const wed1830: ScheduleSlot[] = [{ dayOfWeek: "wednesday", startTime: "18:30:00" }];

const USERS = [user("karachi", "Asia/Karachi"), user("newyork", "America/New_York"), user("london", "Europe/London")];
const SLOTS = { karachi: wed1830, newyork: wed1830, london: wed1830 };

// ---- acceptance ------------------------------------------------------------------

test("3 timezones: quest available at each user's own 18:30 (dry run, simulated now)", async () => {
  const expected: Record<string, string> = {
    "2026-11-18T13:30:00Z": "karachi", // 18:30 PKT (UTC+5)
    "2026-11-18T18:30:00Z": "london", // 18:30 GMT
    "2026-11-18T23:30:00Z": "newyork", // 18:30 EST (UTC−5)
  };
  for (const [iso, who] of Object.entries(expected)) {
    const { store, log } = memoryStore(USERS, { slots: SLOTS, push: ["karachi"] });
    const r = await runNotificationTick({ store, senders: mockSenders().senders, now: new Date(iso), dryRun: true, pageSize: 2 });
    const plan = r.plan!.map((p) => `${p.userId}:${p.type}:${p.channel}`).sort();
    const want = [`${who}:quest_available:email`, ...(who === "karachi" ? ["karachi:quest_available:push"] : [])];
    assert.deepEqual(plan, want, iso);
    assert.equal(log.rows.size, 0, "dry run never writes the log");
  }
  // Between the three local times: nobody.
  const { store } = memoryStore(USERS, { slots: SLOTS });
  const r = await runNotificationTick({ store, senders: mockSenders().senders, now: new Date("2026-11-18T16:00:00Z"), dryRun: true });
  assert.deepEqual(r.plan, []);
});

test("running the cron twice in the same window sends nothing the second time", async () => {
  const { store } = memoryStore(USERS, { slots: SLOTS, push: ["london"] });
  const { senders, sent } = mockSenders();
  const first = await runNotificationTick({ store, senders, now: new Date("2026-11-18T18:30:00Z"), dryRun: false, pageSize: 2 });
  const second = await runNotificationTick({ store, senders, now: new Date("2026-11-18T18:45:00Z"), dryRun: false, pageSize: 2 });
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.deduped, 1);
  assert.deepEqual(sent.map((s) => `${s.channel}:${s.to.split("@")[0]}`).sort(), ["email:london", "push:london"]);
  // Dry run after a real send reports it as already sent.
  const dry = await runNotificationTick({ store, senders, now: new Date("2026-11-18T18:30:00Z"), dryRun: true });
  assert.deepEqual(dry.plan, []);
});

test("batching: one query per data type per page of users (no N+1)", async () => {
  const many = Array.from({ length: 7 }, (_, i) => user(`u${i}`, "Europe/London"));
  const { store, calls } = memoryStore(many, { slots: Object.fromEntries(many.map((u) => [u.id, wed1830])) });
  await runNotificationTick({ store, senders: mockSenders().senders, now: new Date("2026-11-18T18:30:00Z"), dryRun: true, pageSize: 3 });
  // 3 pages of data (3+3+1) plus the final empty users page.
  assert.deepEqual(calls, { users: 4, schedules: 3, quests: 3, push: 3, streak: 0 });
});

test("streak at risk: folded in, uses the app's freeze-aware streak number", async () => {
  const done = (completedAt: string): QuestRecord => ({ questDate: completedAt.slice(0, 10), completedAt, correctCount: 1, totalQuestions: 1, xpEarned: 5 });
  const u = user("s", "America/New_York");
  const { store } = memoryStore([u], {
    quests: { s: [done("2026-11-17T15:00:00Z")] },
    history: { s: ["2026-11-15", "2026-11-16", "2026-11-17"] },
    push: ["s"],
  });
  const { senders, sent } = mockSenders();
  const r = await runNotificationTick({ store, senders, now: new Date("2026-11-19T01:00:00Z"), dryRun: false }); // Wed 20:00 NY
  assert.equal(r.sent, 1);
  assert.match(sent.find((s) => s.channel === "push")!.subject, /3-day streak/);
  assert.match(sent.find((s) => s.channel === "email")!.subject, /3-day streak/);
});

test("expired users and opt-outs are skipped by the scheduler", async () => {
  const expired = user("x", "Europe/London", { subscriptionStatus: "free", trialEndsAt: "2026-11-01T00:00:00Z" });
  const optOut = user("o", "Europe/London", { settings: { quest_available: { email: false, push: false } } });
  const { store } = memoryStore([expired, optOut], { slots: { x: wed1830, o: wed1830 } });
  const r = await runNotificationTick({ store, senders: mockSenders().senders, now: new Date("2026-11-18T18:30:00Z"), dryRun: true });
  assert.deepEqual(r.plan, []);
});

// ---- event notifications ------------------------------------------------------------

test("quest-complete event: one combined message per quest, deduped", async () => {
  const log = new MemoryLog();
  const { senders, sent } = mockSenders();
  let ctx: QuestCompleteContext = {
    settings: {},
    overallLevel: 2,
    lastMeta: { overallLevel: 1, milestone: null },
    recentQuests: [
      { id: "old", correctCount: 6, totalQuestions: 10 },
      { id: "q1", correctCount: 10, totalQuestions: 10 },
    ],
    pushSubs: [{ endpoint: "e", p256dh: "k", auth: "a" }],
  };
  const deps = { loadContext: async () => ctx, claim: async (rows: LogRow[]) => log.claim(rows), senders };
  const input = {
    user: { id: "u", email: "u@example.test", displayName: "U", timezone: "Europe/London", subscriptionStatus: "active", trialEndsAt: null, createdAt: "2026-10-01T00:00:00Z" },
    questId: "q1",
    xpEarned: 50,
    rankUp: { from: { name: "Bronze" }, to: { name: "Silver" } },
    now: new Date("2026-11-18T15:00:00Z"),
  };

  const first = await notifyQuestComplete(deps, input);
  assert.equal(first.sent, true);
  assert.deepEqual(first.events, { xpEarned: 50, levelUp: 2, tierPromotion: "Silver", milestone: 75 });
  assert.equal(sent.length, 2, "one email + one push — a single combined message");
  assert.match(sent[0].subject, /Quest complete/);

  const again = await notifyQuestComplete(deps, input);
  assert.equal(again.sent, false, "same quest again → deduped");
  assert.equal(sent.length, 2);

  // Next day: baseline advanced (level 2, milestone 75) → only XP.
  ctx = { ...ctx, lastMeta: log.rows.get("u|quest_complete|2026-11-18")!.meta as QuestCompleteContext["lastMeta"] };
  const next = await notifyQuestComplete(deps, { ...input, questId: "q2", rankUp: null, now: new Date("2026-11-19T15:00:00Z") });
  assert.deepEqual(next.events, { xpEarned: 50, levelUp: null, tierPromotion: null, milestone: null });

  // Quiet hours: recorded (baseline) but not sent.
  const quiet = await notifyQuestComplete(deps, { ...input, questId: "q3", now: new Date("2026-11-20T23:30:00Z") });
  assert.equal(quiet.sent, false);
  assert.equal(log.rows.get("u|quest_complete|2026-11-20")?.channel, "none");
  assert.equal(sent.length, 4);
});
