// Test accounts. `+clerk_test` makes Clerk's dev instance accept code 424242 and send no email.
// example.com is used because no test domain was given (noted in the report).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export type Role =
  | "trial"
  | "trial-lastday"
  | "expired"
  | "pro"
  | "pro-annual"
  | "trial-other"
  // suite/ specs (quest, accountability, a11y/responsive, billing, notifications)
  | "quest"
  | "ui"
  | "billing"
  | "notify";

export const ROLES: Role[] = [
  "trial", "trial-lastday", "expired", "pro", "pro-annual", "trial-other",
  "quest", "ui", "billing", "notify",
];

export const emailFor = (role: Role) => `e2e+${role}+clerk_test@example.com`;
export const CLERK_TEST_CODE = "424242";

const here = path.dirname(fileURLToPath(import.meta.url));
const credsFile = path.resolve(here, "../.auth/creds.json");

/** One random password shared by all e2e accounts, kept in the gitignored .auth/ folder. */
export function password(): string {
  fs.mkdirSync(path.dirname(credsFile), { recursive: true });
  if (!fs.existsSync(credsFile)) {
    const pw = `E2e-${crypto.randomBytes(12).toString("base64url")}!9`;
    fs.writeFileSync(credsFile, JSON.stringify({ password: pw }));
  }
  return JSON.parse(fs.readFileSync(credsFile, "utf8")).password;
}
