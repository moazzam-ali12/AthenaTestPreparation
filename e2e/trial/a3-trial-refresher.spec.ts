// Area A (part 3): 2 practice misses -> "Need a refresher?" card (no micro-lesson redirect for trial).
import { test, expect } from "../lib/fixtures";
import { closeDb } from "../lib/db";
import { resetToFreshTrial, subtopicsOf, ensurePracticeProblems } from "../lib/state";
import { missTwiceInPractice, clickLog } from "../lib/flows";

import { TRIAL_MODE } from "../lib/env";

// Quota-trial spec: runs only against TRIAL_MODE = 'limited' (E2E_TRIAL_MODE=limited).
test.skip(TRIAL_MODE !== "limited", "limited-trial spec; the app runs the full trial");

test.beforeAll(async () => {
  await resetToFreshTrial("trial");
  await ensurePracticeProblems((await subtopicsOf("aud"))[0]);
});
test.afterAll(closeDb);

test("A practice: 2 misses show the refresher card, Keep practising continues", async ({ as }) => {
  const page = await as("trial");
  await missTwiceInPractice(page, (await subtopicsOf("aud"))[0]);
  (await import("node:fs")).writeFileSync("test-results/practice-clicks.txt", clickLog.join("\n"));
  await expect(page.getByText("Need a refresher?")).toBeVisible({ timeout: 30_000 });
  expect(clickLog, "answer revealed after the 2nd miss").toContain("revealed");
  expect(clickLog, "revealed answer never marked correct").not.toContain("FALSE-CORRECT");
  await expect(page).not.toHaveURL(/micro-lesson/);
  await page.getByRole("button", { name: "Keep practising" }).click();
  await expect(page.getByText("Need a refresher?")).toBeHidden();
  await expect(page).toHaveURL(/\/tutor$/);
});
