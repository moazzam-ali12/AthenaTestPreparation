// Phase 2b: finish onboarding through the app's own onboarding APIs (plan -> complete).
import { test, expect } from "@playwright/test";
import { ROLES, emailFor } from "../lib/accounts";
import { userByEmail, closeDb } from "../lib/db";
import { signIn, api } from "../lib/fixtures";

test.afterAll(closeDb);

for (const role of ROLES) {
  test(`onboard ${role}`, async ({ page }) => {
    test.skip(!!(await userByEmail(emailFor(role)))?.onboarding_completed, "already onboarded");
    await signIn(page, role);
    const plan = await api(page, "POST", "/api/onboarding/plan/complete", {
      name: `E2E ${role}`,
      grade: "undergraduate",
      learnerTypes: [],
      interests: [],
      strugglingTopic: "",
      targetDisciplineSection: "BAR",
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const done = await api(page, "POST", "/api/onboarding/complete", {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await userByEmail(emailFor(role)))!.onboarding_completed).toBe(true);
  });
}
