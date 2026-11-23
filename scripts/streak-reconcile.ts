// Backfill + reconcile the stored daily streak (users.current_streak / streak_last_date)
// against the computed one (computeDailyStreak over completed daily quests + freezes).
//
//   python scripts/run-with-env.py .env.staging -- node --import tsx scripts/streak-reconcile.ts            # dry run
//   python scripts/run-with-env.py .env.staging -- node --import tsx scripts/streak-reconcile.ts --apply --confirm-ref <ref>
//
// --dry-run (default): compares and prints counts + up to 10 mismatching user ids. No writes.
// --apply: writes the computed values in batches of 500 (apply_streak_backfill RPC).
import { createClient } from "@supabase/supabase-js";
import {
  computeDailyStreak,
  getEffectiveStreak,
  storedStreakFromHistory,
  type FreezeRange,
} from "../src/lib/streak";

const BATCH = 500;
const PAGE = 1000;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const confirmRef = args[args.indexOf("--confirm-ref") + 1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "(unknown)";
  console.log(`Supabase project ref: ${ref}`);
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}`);
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  if (apply && (!args.includes("--confirm-ref") || confirmRef !== ref)) {
    throw new Error(`--apply refused: pass --confirm-ref ${ref} to write to this project`);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const today = localToday();
  let match = 0;
  let mismatch = 0;
  let written = 0;
  const mismatchIds: string[] = [];

  for (let from = 0; ; from += BATCH) {
    const { data: users, error } = await db
      .from("users")
      .select("id, current_streak, streak_last_date")
      .order("id")
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`users: ${error.message}`);
    if (!users?.length) break;
    const ids = users.map((u) => u.id as string);

    // All completed quest dates for this batch (paged: PostgREST caps rows per request).
    const dates = new Map<string, string[]>();
    for (let q = 0; ; q += PAGE) {
      const { data, error: qe } = await db
        .from("daily_quests")
        .select("user_id, quest_date")
        .in("user_id", ids)
        .eq("status", "completed")
        .order("user_id")
        .order("quest_date")
        .range(q, q + PAGE - 1);
      if (qe) throw new Error(`daily_quests: ${qe.message}`);
      for (const r of data ?? []) {
        const list = dates.get(r.user_id) ?? [];
        list.push(r.quest_date);
        dates.set(r.user_id, list);
      }
      if (!data || data.length < PAGE) break;
    }

    const { data: fr, error: fe } = await db
      .from("streak_freezes")
      .select("user_id, start_date, end_date")
      .in("user_id", ids);
    if (fe) throw new Error(`streak_freezes: ${fe.message}`);
    const freezes = new Map<string, FreezeRange[]>();
    for (const r of fr ?? []) {
      const list = freezes.get(r.user_id) ?? [];
      list.push({ startDate: r.start_date, endDate: r.end_date });
      freezes.set(r.user_id, list);
    }

    const updates: { id: string; current_streak: number; streak_last_date: string | null }[] = [];
    for (const u of users) {
      const d = dates.get(u.id) ?? [];
      const f = freezes.get(u.id) ?? [];
      const expected = storedStreakFromHistory(d, f);
      const stored = { currentStreak: u.current_streak ?? 0, streakLastDate: u.streak_last_date ?? null };
      const same =
        stored.currentStreak === expected.currentStreak &&
        stored.streakLastDate === expected.streakLastDate &&
        getEffectiveStreak(stored, f, today) === computeDailyStreak(d, today, f);
      if (same) match++;
      else {
        mismatch++;
        if (mismatchIds.length < 10) mismatchIds.push(u.id);
        updates.push({ id: u.id, current_streak: expected.currentStreak, streak_last_date: expected.streakLastDate });
      }
    }

    if (apply && updates.length) {
      const { data: n, error: ae } = await db.rpc("apply_streak_backfill", { p_rows: updates });
      if (ae) throw new Error(`apply_streak_backfill: ${ae.message}`);
      written += Number(n ?? 0);
    }
    if (users.length < BATCH) break;
  }

  const total = match + mismatch;
  console.log(`Users: ${total} · match: ${match} · mismatch: ${mismatch} (${total ? ((match / total) * 100).toFixed(1) : "100.0"}% match)`);
  if (mismatchIds.length) console.log(`Mismatching user ids (first ${mismatchIds.length}): ${mismatchIds.join(", ")}`);
  if (apply) console.log(`Written: ${written}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
