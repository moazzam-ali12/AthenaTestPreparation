// Phase 2: create the e2e accounts through the normal Clerk sign-up UI (not SQL).
// Idempotent: accounts that already exist in staging are skipped.
import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { ROLES, emailFor, password, CLERK_TEST_CODE } from "../lib/accounts";
import { userByEmail, closeDb } from "../lib/db";
import { BASE_URL } from "../lib/env";

test.afterAll(closeDb);

for (const role of ROLES) {
  test(`sign up ${role}`, async ({ page }) => {
    const email = emailFor(role);
    test.skip(!!(await userByEmail(email)), "already exists");

    const started = Date.now();
    await setupClerkTestingToken({ page });
    await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "domcontentloaded" });
    await page.locator("input[name=firstName]").fill("E2E");
    await page.locator("input[name=lastName]").fill(role);
    await page.locator("input[name=emailAddress]").fill(email);
    await page.locator("input[name=password]").fill(password());
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Email verification step (+clerk_test addresses accept 424242).
    const otp = page.locator("input[autocomplete='one-time-code'], input[name=code]").first();
    await otp.waitFor({ timeout: 60_000 });
    await otp.click();
    await page.keyboard.type(CLERK_TEST_CODE, { delay: 50 });

    await page.waitForURL((u) => !u.pathname.startsWith("/sign-up"), { timeout: 90_000 });
    // No card is asked for anywhere in the sign-up flow.
    await expect(page.getByText(/card number/i)).toHaveCount(0);

    // The app syncs the Clerk user into Supabase on first load.
    await expect.poll(async () => !!(await userByEmail(email)), { timeout: 90_000 }).toBe(true);
    const u = (await userByEmail(email))!;
    expect(u.stripe_customer_id).toBeNull();
    const days = (u.trial_ends_at!.getTime() - u.created_at.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(Math.abs(u.created_at.getTime() - started)).toBeLessThan(5 * 60_000);
    test.info().annotations.push({ type: "landed", description: new URL(page.url()).pathname });
  });
}
