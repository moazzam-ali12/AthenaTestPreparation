// Direct SQL against athena-staging (service connection) for state setup and DB checks.
import pg from "pg";
import { env, STAGING_REF } from "./env";

const conn = (env.DATABASE_URL ?? "").replace(":6543/", ":5432/");
if (!conn.includes(`postgres.${STAGING_REF}:`)) throw new Error("e2e/db: not the staging database");

let pool: pg.Pool | null = null;
function getPool() {
  pool ??= new pg.Pool({ connectionString: conn, max: 3, ssl: { rejectUnauthorized: false } });
  return pool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

export type UserRow = {
  id: string;
  clerk_id: string;
  email: string;
  subscription_status: string | null;
  plan_type: string | null;
  stripe_customer_id: string | null;
  trial_ends_at: Date | null;
  created_at: Date;
  onboarding_completed: boolean;
};

export async function userByEmail(email: string): Promise<UserRow | undefined> {
  return one<UserRow>("select * from users where lower(email) = lower($1)", [email]);
}

/** Only ever touches e2e test accounts. */
export async function setUser(email: string, setSql: string, params: unknown[] = []) {
  if (!/^e2e\+/i.test(email)) throw new Error(`setUser refused for non-e2e account ${email}`);
  await q(`update users set ${setSql} where lower(email) = lower($1)`, [email, ...params]);
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
