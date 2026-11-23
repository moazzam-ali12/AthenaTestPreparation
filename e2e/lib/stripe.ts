// Stripe test-mode helpers: REST calls with the test secret key, hosted checkout, signed webhook replay.
import crypto from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { env, BASE_URL } from "./env";

const KEY = env.STRIPE_SECRET_KEY!;
if (!KEY.startsWith("sk_test_")) throw new Error("e2e/stripe: not a test key");

export async function stripe<T = any>(method: string, path: string, form?: Record<string, string>): Promise<T> {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`stripe ${method} ${path}: ${body?.error?.message}`);
  return body as T;
}

/** Fills Stripe's hosted checkout with the 4242 test card and pays. */
export async function payHostedCheckout(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  const card = page.locator("#cardNumber");
  await card.waitFor({ timeout: 60_000 });
  await card.fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  const name = page.locator("#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("E2E Tester");
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill("10001");
  // Opt out of Link if it offers to save the card.
  const link = page.locator("#enableStripePass");
  if (await link.isChecked().catch(() => false)) await link.uncheck();
  await page.locator("button[type=submit], [data-testid=hosted-payment-submit-button]").first().click();
  await page.waitForURL((u) => u.href.startsWith(BASE_URL), { timeout: 120_000 });
}

async function postSigned(event: unknown) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return { status: r.status, body: await r.text() };
}

/**
 * Tells the app's webhook "this customer changed" with a signed event, so specs don't depend on
 * `stripe listen`. The handler re-reads every subscription from Stripe, so only the customer id
 * matters. `created` = the test clock's time (anchors the failed-payment grace period).
 */
export async function syncCustomerViaWebhook(customerId: string, type = "customer.subscription.updated", created?: number) {
  const id = `evt_e2e_${crypto.randomBytes(8).toString("hex")}`;
  return postSigned({
    id, object: "event", type, api_version: "2025-01-01", livemode: false,
    created: created ?? Math.floor(Date.now() / 1000),
    data: { object: { object: type.startsWith("invoice") ? "invoice" : "subscription", customer: customerId } },
  });
}

/** A Stripe test clock frozen at `now`, for renewal / failure / cancel scenarios without waiting. */
export async function createTestClock(name: string) {
  return stripe<{ id: string; frozen_time: number }>("POST", "/test_helpers/test_clocks", {
    frozen_time: String(Math.floor(Date.now() / 1000)),
    name,
  });
}

/** Advances a test clock and waits until Stripe has finished processing (status ready). */
export async function advanceClock(clockId: string, toUnix: number) {
  await stripe("POST", `/test_helpers/test_clocks/${clockId}/advance`, { frozen_time: String(toUnix) });
  await expect
    .poll(async () => (await stripe<{ status: string }>("GET", `/test_helpers/test_clocks/${clockId}`)).status, {
      message: "test clock finished advancing",
      timeout: 180_000,
      intervals: [1_000, 2_000],
    })
    .toBe("ready");
}

/** Attaches a test card token (pm_card_visa, pm_card_chargeCustomerFail, …) as the customer's default. */
export async function setDefaultCard(customerId: string, token: string) {
  const pm = await stripe<{ id: string }>("POST", `/payment_methods/${token}/attach`, { customer: customerId });
  await stripe("POST", `/customers/${customerId}`, { "invoice_settings[default_payment_method]": pm.id });
  return pm.id;
}

/** Re-delivers an already-processed event to the local webhook with a valid signature. */
export async function replayEvent(eventId: string) {
  const secret = env.STRIPE_WEBHOOK_SECRET!;
  const event = await stripe("GET", `/events/${eventId}`);
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return { status: r.status, body: await r.text() };
}
