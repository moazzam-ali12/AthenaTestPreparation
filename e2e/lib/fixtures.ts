// Shared Playwright fixtures: sign in as a role, call APIs from inside the page (so Clerk keeps
// the session token fresh), and record every network response that leaks answer keys.
import { test as base, expect, type Page, type Response } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { emailFor, type Role } from "./accounts";
import { BASE_URL } from "./env";

export type ApiResult<T = any> = { status: number; body: T };

export async function signIn(page: Page, role: Role) {
  await setupClerkTestingToken({ page });
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
  await clerk.loaded({ page });
  // Sign-in token via the Clerk backend API: skips password + new-device email check.
  await clerk.signIn({ page, emailAddress: emailFor(role) });
  // Land on a protected page so the session cookie is set before any API call.
  await page.goto(`${BASE_URL}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });
}

export async function api<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return { status: r.status, body: parsed as any };
    },
    { method, url, body }
  );
}

/** Reads a streaming endpoint to the end and returns the raw text (SSE). */
export async function apiStream(page: Page, url: string, body: unknown): Promise<ApiResult<string>> {
  return page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.text() };
    },
    { url, body }
  );
}

// Answer-key fields that must never reach the browser while an attempt is in progress.
// Masked values (correctOption: -1, isCorrect: null) are fine; real values are a leak.
const KEY_FIELDS =
  /"(correctOption|correct_option|correctAnswer|correct_answer)"\s*:\s*\d|"(answerKey|answer_key)"\s*:|"answers"\s*:\s*\{|"isCorrect"\s*:\s*(true|false)/;

export type Leak = { url: string; field: string };

type Fixtures = { as: (role: Role) => Promise<Page>; leaks: Leak[] };

export const test = base.extend<Fixtures>({
  leaks: async ({}, use) => {
    await use([]);
  },
  as: async ({ page, leaks }, use) => {
    page.on("response", async (res: Response) => {
      const url = res.url();
      if (!url.includes("/api/") || !(res.headers()["content-type"] ?? "").includes("json")) return;
      try {
        const text = await res.text();
        const m = text.match(KEY_FIELDS);
        if (m) leaks.push({ url: url.replace(BASE_URL, ""), field: m[0].slice(0, 40) });
      } catch {}
    });
    await use(async (role: Role) => {
      await signIn(page, role);
      return page;
    });
  },
});

export { expect };

/** Opens a page and waits for the app shell (not networkidle: dev HMR keeps a socket open). */
export async function open(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
}
