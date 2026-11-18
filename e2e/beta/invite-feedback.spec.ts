// Beta launch: invite-code sign-up tags the user as cohort 'beta'; expired / used-up codes are
// rejected; in-app feedback saves with page/browser info; only admins can read feedback.
// Creates one throwaway account (e2e+beta+clerk_test@example.com), deleted again before each run.
import { expect, test } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { CLERK_TEST_CODE, emailFor, password } from "../lib/accounts";
import { closeDb, one, q, setUser, userByEmail } from "../lib/db";
import { BASE_URL, env } from "../lib/env";
import { api, signIn } from "../lib/fixtures";

const EMAIL = "e2e+beta+clerk_test@example.com";
const ADMIN_ROLE = "pro" as const;
const RUN = Date.now().toString(36).toUpperCase();
const CODES = { valid: `E2E-OK-${RUN}`, expired: `E2E-EXP-${RUN}`, usedUp: `E2E-FULL-${RUN}` };
// 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** Remove the throwaway account from Clerk and staging (events/feedback cascade). */
async function deleteBetaAccount() {
  const row = await userByEmail(EMAIL);
  const headers = { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` };
  const found = await fetch(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(EMAIL)}`,
    { headers }
  ).then((r) => r.json() as Promise<{ id: string }[]>);
  for (const u of found) await fetch(`https://api.clerk.com/v1/users/${u.id}`, { method: "DELETE", headers });
  if (row) await q("delete from users where id = $1 and email like 'e2e+%'", [row.id]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await deleteBetaAccount();
  await q(
    `insert into beta_invites (code, max_uses, used, expires_at, note) values
       ($1, 1, 0, now() + interval '1 day', 'e2e'),
       ($2, 5, 0, now() - interval '1 minute', 'e2e'),
       ($3, 2, 2, null, 'e2e')`,
    [CODES.valid, CODES.expired, CODES.usedUp]
  );
});

test.afterAll(async () => {
  await q("delete from beta_invites where note = 'e2e' and code like 'E2E-%'");
  await setUser(emailFor(ADMIN_ROLE), "is_admin = false");
  await deleteBetaAccount();
  await closeDb();
});

test("expired and used-up invite codes are rejected", async ({ page, request }) => {
  for (const [code, status] of [
    [CODES.expired, "expired"],
    [CODES.usedUp, "used_up"],
    ["E2E-NOPE-" + RUN, "invalid"],
  ] as const) {
    const r = await request.get(`${BASE_URL}/api/beta/invite?code=${code}`);
    expect(await r.json(), code).toMatchObject({ valid: false, status });
    expect(r.headers()["set-cookie"] ?? "", code).not.toContain(`athena_beta_invite=${code}`);
  }
  await page.goto(`${BASE_URL}/sign-up?invite=${CODES.expired}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("invite-status")).toHaveAttribute("data-valid", "false");
});

test("invite sign-up tags the user as beta and uses up the code; feedback saves", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto(`${BASE_URL}/sign-up?invite=${CODES.valid.toLowerCase()}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("invite-status")).toHaveAttribute("data-valid", "true");

  await page.locator("input[name=firstName]").fill("E2E");
  await page.locator("input[name=lastName]").fill("beta");
  await page.locator("input[name=emailAddress]").fill(EMAIL);
  await page.locator("input[name=password]").fill(password());
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const otp = page.locator("input[autocomplete='one-time-code'], input[name=code]").first();
  await otp.waitFor({ timeout: 60_000 });
  await otp.click();
  await page.keyboard.type(CLERK_TEST_CODE, { delay: 50 });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-up"), { timeout: 90_000 });

  // Synced on first load → cohort 'beta', one use consumed, signup event recorded.
  await expect.poll(async () => (await one<{ cohort: string | null }>(
    "select cohort from users where lower(email) = lower($1)", [EMAIL]))?.cohort ?? null, { timeout: 90_000 })
    .toBe("beta");
  const user = (await userByEmail(EMAIL))!;
  expect((await one<{ used: number }>("select used from beta_invites where code = $1", [CODES.valid]))!.used).toBe(1);
  await expect.poll(async () => (await q("select 1 from events where user_id = $1 and name = 'signup'", [user.id])).length)
    .toBe(1);
  // No PII in any event props.
  const leaky = await one<{ n: string }>(
    "select count(*) n from events where props::text ~* '(@|e2e\\+|\"(email|name|phone)\")'"
  );
  expect(Number(leaky!.n)).toBe(0);

  // The single-use code is now used up for anyone else.
  const again = await page.request.get(`${BASE_URL}/api/beta/invite?code=${CODES.valid}`);
  expect(await again.json()).toMatchObject({ valid: false, status: "used_up" });

  // In-app feedback (a brand-new user may be redirected into onboarding; any protected page works).
  await page.goto(`${BASE_URL}/profile?tab=e2e`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("feedback-button").click();
  const at = new URL(page.url());
  await page.getByTestId("feedback-type-confusing").click();
  await page.getByTestId("feedback-message").fill(`e2e feedback ${RUN}`);
  await page.getByTestId("feedback-screenshot").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("feedback-submit").click();
  await expect(page.getByText("Your feedback was sent")).toBeVisible();

  const fb = await one<Record<string, string | null>>(
    "select type, page_url, user_agent, app_version, screenshot_path, status from feedback where user_id = $1",
    [user.id]
  );
  expect(fb).toMatchObject({ type: "confusing", page_url: at.pathname + at.search, status: "new" });
  expect(fb!.user_agent).toBeTruthy();
  expect(fb!.app_version).toBeTruthy();
  expect(fb!.screenshot_path).toMatch(new RegExp(`^${user.id}/.+\\.png$`));

  // A non-admin can't read feedback: admin API is a 404, and the browser key sees no rows (RLS).
  expect((await api(page, "GET", "/api/admin/beta")).status).toBe(404);
  const anon = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/feedback?select=id`, {
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY}`,
    },
  });
  expect(anon.ok ? await anon.json() : []).toEqual([]);
});

test("admin sees the feedback, can triage it, and gets funnel counts", async ({ page }) => {
  await setUser(emailFor(ADMIN_ROLE), "is_admin = true");
  await signIn(page, ADMIN_ROLE);
  const r = await api(page, "GET", "/api/admin/beta");
  expect(r.status).toBe(200);
  const mine = r.body.feedback.find((f: { message: string }) => f.message === `e2e feedback ${RUN}`);
  expect(mine).toBeTruthy();
  expect(mine.screenshot_url).toMatch(/^https:\/\//);
  const step = (rows: { step: string; users: number }[], s: string) => rows.find((x) => x.step === s)?.users ?? -1;
  expect(step(r.body.funnel.beta, "signup")).toBeGreaterThanOrEqual(1);
  expect(r.body.funnel.beta.map((x: { step: string }) => x.step)).toEqual([
    "signup", "onboarding_done", "first_quest", "day3_return", "subscribed",
  ]);

  const patched = await api(page, "PATCH", `/api/admin/beta/feedback/${mine.id}`, { status: "triaged" });
  expect(patched).toMatchObject({ status: 200, body: { status: "triaged" } });
  expect((await api(page, "PATCH", `/api/admin/beta/feedback/${mine.id}`, { status: "done" })).status).toBe(400);

  const pageRes = await page.goto(`${BASE_URL}/admin/beta`, { waitUntil: "domcontentloaded" });
  expect(pageRes?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Funnel" })).toBeVisible();
});
