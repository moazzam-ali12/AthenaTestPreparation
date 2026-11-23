// SQL test for record_streak_day (migration 20261116000000_stored_streak.sql).
// Runs ONLY against a throwaway Postgres given by STREAK_TEST_PG (a psql connection
// string), never against Supabase:
//   STREAK_TEST_PG="postgresql://postgres@localhost:55432/postgres" node --import tsx --test supabase/tests/stored-streak.sql.test.ts
// It loads a minimal users/streak_freezes schema plus the real migration, then checks the
// SQL rule against computeDailyStreak on the shared fixtures.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { FIXTURES } from "../../src/lib/streak.fixtures";
import { storedStreakFromHistory } from "../../src/lib/streak";

const PG = process.env.STREAK_TEST_PG ?? "";
const MIGRATIONS = path.resolve("supabase/migrations"); // run from the repo root
const skip = !PG || /supabase\.(co|com)/.test(PG) ? "set STREAK_TEST_PG to a throwaway Postgres" : false;

function psql(sql: string): string {
  return execFileSync("psql", [PG, "-qtA", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
}
function psqlFile(file: string) {
  execFileSync("psql", [PG, "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8", stdio: "pipe" });
}

async function newUser(): Promise<string> {
  return psql("insert into users default values returning id");
}
function record(id: string, day: string): [number, string] {
  const [streak, last] = psql(`select current_streak || '|' || streak_last_date from record_streak_day('${id}', '${day}')`).split("|");
  return [Number(streak), last];
}

before(() => {
  if (skip) return;
  psql(`drop table if exists streak_freezes, users cascade;
        create table users (id uuid primary key default gen_random_uuid(), clerk_id text,
          current_streak integer not null default 0, best_streak integer not null default 0);`);
  psql(`create schema if not exists auth;
        create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  psqlFile(path.join(MIGRATIONS, "20261115000000_streak_freezes.sql"));
  psqlFile(path.join(MIGRATIONS, "20261116000000_stored_streak.sql"));
  psqlFile(path.join(MIGRATIONS, "20261116000000_stored_streak.sql")); // idempotent
});

test("same day twice → unchanged; next day → +1; missed day → 1; frozen gap → continues", { skip }, async () => {
  const id = await newUser();
  assert.deepEqual(record(id, "2026-11-01"), [1, "2026-11-01"]);
  assert.deepEqual(record(id, "2026-11-01"), [1, "2026-11-01"], "same day twice");
  assert.deepEqual(record(id, "2026-11-02"), [2, "2026-11-02"], "next day");
  assert.deepEqual(record(id, "2026-11-01"), [2, "2026-11-02"], "older day: no change");
  assert.deepEqual(record(id, "2026-11-04"), [1, "2026-11-04"], "missed Nov 3");
  for (const d of ["05", "06", "07", "08", "09", "10"]) record(id, `2026-11-${d}`);
  assert.equal(psql(`select current_streak from users where id = '${id}'`), "7");
  psql(`insert into streak_freezes (user_id, start_date, end_date) values ('${id}', '2026-11-11', '2026-11-13')`);
  assert.deepEqual(record(id, "2026-11-14"), [8, "2026-11-14"], "frozen gap: 7 -> 8");
  assert.equal(psql(`select best_streak from users where id = '${id}'`), "8");
});

test("SQL rule matches computeDailyStreak on the shared fixtures", { skip }, async () => {
  for (const f of FIXTURES) {
    const id = await newUser();
    for (const fr of f.freezes) {
      psql(`insert into streak_freezes (user_id, start_date, end_date) values ('${id}', '${fr.startDate}', '${fr.endDate}')`);
    }
    for (const d of f.dates) record(id, d);
    const row = psql(`select current_streak || '|' || coalesce(streak_last_date::text, '') from users where id = '${id}'`);
    const expected = storedStreakFromHistory(f.dates, f.freezes);
    assert.equal(row, `${expected.currentStreak}|${expected.streakLastDate ?? ""}`, f.name);
  }
});

test("20 parallel calls for the same day → +1 only", { skip }, async () => {
  const id = await newUser();
  record(id, "2026-11-01");
  const sql = `select record_streak_day('${id}', '2026-11-02')`;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      new Promise<void>((resolve, reject) => {
        const p = spawn("psql", [PG, "-qtA", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "ignore" });
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`psql exit ${code}`))));
      })
    )
  );
  assert.equal(psql(`select current_streak || '|' || streak_last_date from users where id = '${id}'`), "2|2026-11-02");
});

test("only the service role may execute the functions", { skip }, async () => {
  const roles = psql("select count(*) from pg_roles where rolname in ('anon','authenticated')");
  if (roles !== "2") return; // plain Postgres: no Supabase roles to check
  assert.equal(psql("select has_function_privilege('anon', 'record_streak_day(uuid,date)', 'execute')"), "f");
});
