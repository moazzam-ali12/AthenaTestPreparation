// Loads ../.env.staging and refuses to run against anything but athena-staging.
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env.staging"), override: true, quiet: true });

export const STAGING_REF = "kumtumkzkcwvkwbgskjo";
export const PROD_REF = "dogndxrbvpobtavpphdn";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const db = process.env.DATABASE_URL ?? "";
if (!url.includes(STAGING_REF) || !db.includes(STAGING_REF) || url.includes(PROD_REF) || db.includes(PROD_REF)) {
  throw new Error("e2e: env does not point at athena-staging — refusing to run");
}
for (const k of ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
  const v = process.env[k] ?? "";
  if (!/^(sk|pk)_test_/.test(v)) throw new Error(`e2e: ${k} is not a test-mode key — refusing to run`);
}
// @clerk/testing reads these names.
process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const env = process.env;

/**
 * Must match TRIAL_MODE in src/lib/trial.ts on the app under test. 'full' runs
 * a-full-trial.spec.ts; 'limited' runs the quota specs (a1/a2/a3).
 */
export const TRIAL_MODE: "full" | "limited" = process.env.E2E_TRIAL_MODE === "limited" ? "limited" : "full";
