// Payments on a Stripe test clock: subscribe, renewal, failed payment (+ grace if deployed),
// recovery, cancel at period end, reactivate with a coupon. Desktop only (one Stripe run).
import { test, expect, api } from "../lib/fixtures";
import { closeDb, one, setUser } from "../lib/db";
import { emailFor } from "../lib/accounts";
import { userRow } from "../lib/state";
import { env } from "../lib/env";
import { advanceClock, createTestClock, setDefaultCard, stripe, syncCustomerViaWebhook } from "../lib/stripe";
import type { Page } from "@playwright/test";

const ROLE = "billing" as const;
const EMAIL = emailFor(ROLE);
const PRICE = env.STRIPE_PRICE_ID_MONTHLY ?? env.STRIPE_PRICE_ID;
const DAY = 86_400;

type Sub = { id: string; status: string; latest_invoice: string; cancel_at_period_end: boolean; items: { data: { current_period_end: number }[] } };
const s: { clock?: string; now?: number; customer?: string; sub?: Sub; graceBuilt?: boolean } = {};

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Stripe test clocks run once, on desktop"));

test.beforeAll(async ({}, info) => {
  if (info.project.name !== "desktop") return;
  if (!PRICE) throw new Error("STRIPE_PRICE_ID_MONTHLY not set in .env.staging");
  // Re-runs: deleting the old clock deletes its customer and subscriptions.
  const prev = await userRow(ROLE);
  if (prev.stripe_customer_id) {
    const c = await stripe("GET", `/customers/${prev.stripe_customer_id}`).catch(() => null);
    if (c?.test_clock) await stripe("DELETE", `/test_helpers/test_clocks/${c.test_clock}`).catch(() => {});
  }
  // Trial over, so losing the subscription means "expired", not "trial".
  await setUser(EMAIL, `subscription_status = 'free', plan_type = 'free', trial_ends_at = now() - interval '1 day', stripe_customer_id = null`);
  s.graceBuilt = !!(await one("select 1 from information_schema.columns where table_name = 'users' and column_name = 'payment_failed_at'"));
  const clock = await createTestClock("e2e billing");
  s.clock = clock.id;
  s.now = clock.frozen_time;
  const customer = await stripe("POST", "/customers", { email: EMAIL, test_clock: clock.id, name: "E2E billing" });
  s.customer = customer.id;
  await setDefaultCard(customer.id, "pm_card_visa");
  await setUser(EMAIL, "stripe_customer_id = $2", [customer.id]);
});

test.afterAll(async () => {
  if (s.clock) await stripe("DELETE", `/test_helpers/test_clocks/${s.clock}`).catch(() => {});
  await setUser(EMAIL, "stripe_customer_id = null, subscription_status = 'free', plan_type = 'free'").catch(() => {});
  await closeDb();
});

async function sync(type?: string) {
  const r = await syncCustomerViaWebhook(s.customer!, type, s.now);
  expect(r.status, r.body.slice(0, 200)).toBe(200);
}
async function refreshSub() {
  s.sub = await stripe<Sub>("GET", `/subscriptions/${s.sub!.id}`);
  return s.sub;
}
async function advanceTo(unix: number) {
  if (unix <= s.now!) return; // already there (an earlier test advanced it but Stripe didn't renew)
  await advanceClock(s.clock!, unix);
  s.now = unix;
}
const periodEnd = () => s.sub!.items.data[0].current_period_end;

/**
 * Renewal: advances the test clock a day past the period end. On the staging Stripe account the
 * clock advances but never cycles the subscription (no renewal invoice; reproduced outside the app,
 * 2026-11-17), so if the period didn't roll, the renewal is forced at the clock's time with a cycle
 * reset billed immediately (`billing_cycle_anchor=now`, `always_invoice`): same charge on the
 * default card, same invoice/subscription events, period extended.
 */
async function renew() {
  const end = periodEnd();
  await advanceTo(end + DAY);
  const rolled = (await refreshSub()).items.data[0].current_period_end > end || s.sub!.status !== "active";
  if (!rolled) {
    test.info().annotations.push({ type: "note", description: "test clock didn't cycle the subscription; renewal invoiced via cycle reset" });
    await stripe("POST", `/subscriptions/${s.sub!.id}`, { billing_cycle_anchor: "now", proration_behavior: "always_invoice" });
    await refreshSub();
  }
}
const tier = async (page: Page) => (await api(page, "GET", "/api/trial")).body.tier as string;

test("subscribe: active, Pro access", { tag: "@smoke" }, async ({ as }) => {
  s.sub = await stripe<Sub>("POST", "/subscriptions", { customer: s.customer!, "items[0][price]": PRICE! });
  expect(s.sub.status).toBe("active");
  await sync("customer.subscription.created");
  const u = await userRow(ROLE);
  expect([u.subscription_status, u.plan_type]).toEqual(["active", "pro"]);
  expect(await tier(await as(ROLE))).toBe("pro");
});

test("renewal: clock past the period end -> invoice paid, period extended, still Pro", async ({ as }) => {
  const end = periodEnd();
  await renew();
  const sub = s.sub!;
  expect(sub.status).toBe("active");
  expect(sub.items.data[0].current_period_end).toBeGreaterThan(end);
  expect((await stripe("GET", `/invoices/${sub.latest_invoice}`)).status).toBe("paid");
  await sync("invoice.paid");
  const u = (await userRow(ROLE)) as any;
  expect(u.subscription_status).toBe("active");
  expect(Math.abs(new Date(u.subscription_end_date).getTime() / 1000 - sub.items.data[0].current_period_end)).toBeLessThan(60);
  expect(await tier(await as(ROLE))).toBe("pro");
});

test("failed payment -> past_due (grace keeps Pro if built) -> card fixed -> active", async ({ as }) => {
  await setDefaultCard(s.customer!, "pm_card_chargeCustomerFail");
  await renew();
  const sub = s.sub!;
  expect(sub.status).toBe("past_due");
  await sync("invoice.payment_failed");
  const u = (await userRow(ROLE)) as any;
  expect(u.subscription_status).toBe("past_due");
  const page = await as(ROLE);
  if (s.graceBuilt) {
    expect(u.payment_failed_at, "grace period started").toBeTruthy();
    expect(await tier(page), "Pro during the grace period").toBe("pro");
  } else {
    test.info().annotations.push({ type: "note", description: "payment_failed_at not on staging: grace not deployed, skipped" });
    expect(await tier(page), "no grace: access ends").toBe("expired");
  }

  await setDefaultCard(s.customer!, "pm_card_visa");
  await stripe("POST", `/invoices/${sub.latest_invoice}/pay`);
  expect((await refreshSub()).status).toBe("active");
  await sync("invoice.paid");
  const fixed = (await userRow(ROLE)) as any;
  expect(fixed.subscription_status).toBe("active");
  if (s.graceBuilt) expect(fixed.payment_failed_at, "grace cleared after payment").toBeNull();
  expect(await tier(page)).toBe("pro");
});

test("cancel at period end: Pro until the end, then expired", async ({ as }) => {
  await stripe("POST", `/subscriptions/${s.sub!.id}`, { cancel_at_period_end: "true" });
  await sync();
  const page = await as(ROLE);
  expect((await userRow(ROLE)).subscription_status).toBe("active");
  expect(await tier(page), "still Pro before the period ends").toBe("pro");

  await advanceTo(periodEnd() + DAY);
  if ((await refreshSub()).status !== "canceled") {
    // Same Stripe clock limitation as renew(): end the period by cancelling now instead.
    test.info().annotations.push({ type: "note", description: "clock didn't end the period; cancelled immediately instead" });
    await stripe("DELETE", `/subscriptions/${s.sub!.id}`);
  }
  expect((await refreshSub()).status).toBe("canceled");
  await sync("customer.subscription.deleted");
  expect((await userRow(ROLE)).subscription_status).toBe("canceled");
  expect(await tier(page)).toBe("expired");
});

test("reactivate with a 50% coupon: discounted invoice, Pro again", async ({ as }) => {
  const coupon = await stripe("POST", "/coupons", { percent_off: "50", duration: "once", name: "e2e 50%" });
  try {
    s.sub = await stripe<Sub>("POST", "/subscriptions", {
      customer: s.customer!, "items[0][price]": PRICE!, "discounts[0][coupon]": coupon.id,
    });
    expect(s.sub.status).toBe("active");
    const inv = await stripe("GET", `/invoices/${s.sub.latest_invoice}`);
    const price = await stripe("GET", `/prices/${PRICE}`);
    expect(inv.amount_paid).toBe(Math.round(price.unit_amount / 2));
    await sync("customer.subscription.created");
    expect((await userRow(ROLE)).subscription_status).toBe("active");
    expect(await tier(await as(ROLE))).toBe("pro");
  } finally {
    await stripe("DELETE", `/coupons/${coupon.id}`).catch(() => {});
  }
});
