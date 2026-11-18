import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_EVENT_NAMES, isEventName, sanitizeProps } from "./analytics-props";

test("sanitizeProps keeps flat, non-identifying primitives", () => {
  assert.deepEqual(sanitizeProps({ section: "FAR", correct: 4, firstTime: true, plan: null }), {
    section: "FAR",
    correct: 4,
    firstTime: true,
    plan: null,
  });
});

test("sanitizeProps drops PII-looking keys", () => {
  const out = sanitizeProps({
    email: "a@b.co",
    userEmail: "x",
    display_name: "Ann",
    firstName: "Ann",
    phone: "1",
    ip: "1.2.3.4",
    page_url: "/x",
    message: "hi",
    reason: "trial_ended",
  });
  assert.deepEqual(out, { reason: "trial_ended" });
});

test("sanitizeProps drops PII-looking values, nested values and long strings", () => {
  const out = sanitizeProps({
    a: "someone@example.com",
    b: "+1 (555) 123-4567",
    c: { nested: 1 },
    d: [1, 2],
    e: "x".repeat(65),
    f: Number.NaN,
    ok: "monthly",
  });
  assert.deepEqual(out, { ok: "monthly" });
});

test("sanitizeProps rejects non-objects and caps key count", () => {
  assert.deepEqual(sanitizeProps(null), {});
  assert.deepEqual(sanitizeProps("str"), {});
  assert.deepEqual(sanitizeProps([1]), {});
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(sanitizeProps(many)).length, 12);
});

test("event names: only known names; browser may only send paywall_viewed", () => {
  assert.ok(isEventName("signup"));
  assert.ok(!isEventName("page_view"));
  assert.deepEqual([...CLIENT_EVENT_NAMES], ["paywall_viewed"]);
});
