// Admin panel access control: every /admin page and /api/admin route is a 404 for anyone but an
// admin (users.is_admin), including signed-out requests. The admin side checks one audited write.
import { test, expect, api } from "../lib/fixtures";
import { closeDb, one, q, setUser } from "../lib/db";
import { emailFor } from "../lib/accounts";
import { BASE_URL } from "../lib/env";
import { userRow } from "../lib/state";

const ADMIN_ROLE = "pro" as const;
const NON_ADMIN_ROLE = "trial" as const;
const ZERO = "00000000-0000-4000-8000-000000000000";

const PAGES = ["/admin", "/admin/questions", "/admin/tbs", "/admin/balance", "/admin/users", "/admin/does-not-exist"];
const APIS: [string, string, unknown?][] = [
  ["GET", "/api/admin/questions"],
  ["GET", `/api/admin/questions/${ZERO}`],
  ["PATCH", `/api/admin/questions/${ZERO}`, { status: "approved" }],
  ["GET", "/api/admin/tbs"],
  ["GET", `/api/admin/tbs/${ZERO}`],
  ["PATCH", `/api/admin/tbs/${ZERO}`, { status: "approved" }],
  ["POST", `/api/admin/tbs/${ZERO}/sample`, {}],
  ["GET", "/api/admin/balance"],
  ["GET", "/api/admin/subtopics"],
  ["GET", "/api/admin/users?q=e2e"],
  ["GET", `/api/admin/users/${ZERO}`],
  ["POST", `/api/admin/users/${ZERO}/actions`, { action: "extend_trial", days: 1 }],
  ["GET", "/api/admin/unknown"],
];

test.beforeAll(async () => {
  await setUser(emailFor(ADMIN_ROLE), "is_admin = true");
  await setUser(emailFor(NON_ADMIN_ROLE), "is_admin = false");
});
test.afterAll(async () => {
  await setUser(emailFor(ADMIN_ROLE), "is_admin = false");
  await closeDb();
});

test("signed out: every admin page and API is 404", async ({ request }) => {
  for (const path of PAGES) {
    const r = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
    expect(r.status(), path).toBe(404);
  }
  for (const [method, path, body] of APIS) {
    const r = await request.fetch(`${BASE_URL}${path}`, { method, data: body, maxRedirects: 0 });
    expect(r.status(), `${method} ${path}`).toBe(404);
  }
});

test("signed-in non-admin: every admin page and API is 404", async ({ as }) => {
  const page = await as(NON_ADMIN_ROLE);
  for (const path of PAGES) {
    const r = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    expect(r?.status(), path).toBe(404);
  }
  for (const [method, path, body] of APIS) {
    const r = await api(page, method, path, body);
    expect(r.status, `${method} ${path}`).toBe(404);
    // Nothing but the generic not-found body: no data, no answer keys.
    expect(JSON.stringify(r.body)).not.toMatch(/answer_key|correct_option|question_text|email/);
  }
});

test("admin: pages load, invalid edits are rejected, writes are audited", async ({ as }) => {
  const page = await as(ADMIN_ROLE);
  for (const path of PAGES.slice(0, 5)) {
    const r = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    expect(r?.status(), path).toBe(200);
  }

  const list = await api(page, "GET", "/api/admin/questions?source=cpa&status=approved");
  expect(list.status).toBe(200);
  expect(list.body.rows.length).toBeGreaterThan(0);
  expect(list.body.rows.length).toBeLessThanOrEqual(list.body.pageSize);

  const target = await one<{ id: string }>(
    "select id from problems where source = 'cpa' and status = 'approved' order by created_at limit 1"
  );
  const id = target!.id;
  const me = await userRow(ADMIN_ROLE);
  const audits = async () =>
    Number((await one<{ n: string }>("select count(*) n from admin_audit_log where target_id = $1", [id]))!.n);
  const before = await audits();

  // Invalid: answer index outside the options, unknown field, bad status.
  expect((await api(page, "PATCH", `/api/admin/questions/${id}`, { correct_option: 99 })).status).toBe(400);
  expect((await api(page, "PATCH", `/api/admin/questions/${id}`, { source: "custom" })).status).toBe(400);
  expect((await api(page, "PATCH", `/api/admin/questions/${id}`, { status: "published" })).status).toBe(400);
  expect(await audits()).toBe(before);

  try {
    expect((await api(page, "PATCH", `/api/admin/questions/${id}`, { status: "archived" })).status).toBe(200);
    expect((await one<{ status: string }>("select status from problems where id = $1", [id]))!.status).toBe("archived");
  } finally {
    expect((await api(page, "PATCH", `/api/admin/questions/${id}`, { status: "approved" })).status).toBe(200);
  }
  const rows = await q<{ action: string; admin_id: string }>(
    "select action, admin_id from admin_audit_log where target_id = $1 order by created_at desc limit 2",
    [id]
  );
  expect(await audits()).toBe(before + 2);
  expect(rows.map((r) => r.action)).toEqual(["question.approved", "question.archived"]);
  expect(rows.every((r) => r.admin_id === me.id)).toBe(true);
});
