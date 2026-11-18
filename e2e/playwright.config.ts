import { defineConfig, devices } from "@playwright/test";
import "./lib/env";
import { BASE_URL } from "./lib/env";

// iPhone 13 descriptor on Chromium (WebKit isn't installed on this Windows box).
const { defaultBrowserType: _ignored, ...iphone13 } = devices["iPhone 13"];

// trial/ = trial & Pro gating; suite/ = quest, accountability, billing, notifications, a11y, responsive.
const SPECS = ["trial/**/*.spec.ts", "suite/**/*.spec.ts"];

export default defineConfig({
  testDir: ".",
  testMatch: ["trial/**/*.spec.ts", "suite/**/*.spec.ts", "admin/**/*.spec.ts", "beta/**/*.spec.ts", "setup/**/*.setup.ts"],
  globalSetup: "./lib/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [
    { name: "accounts", testMatch: "setup/**/*.setup.ts", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop", testMatch: SPECS, use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: SPECS, use: { ...iphone13, browserName: "chromium" } },
    // Admin panel is desktop-only.
    { name: "admin", testMatch: "admin/**/*.spec.ts", use: { viewport: { width: 1440, height: 900 } } },
    // Beta launch: invite sign-up + feedback (creates and deletes one throwaway account).
    { name: "beta", testMatch: "beta/**/*.spec.ts", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
