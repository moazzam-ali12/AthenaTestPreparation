import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTERED, scrubEvent, scrubString } from "./scrub";

test("scrubString masks emails, bearer tokens, JWTs and Stripe data", () => {
  const out = scrubString(
    "user jane.doe@example.com Bearer abc.def-123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig sk_live_51ABCdef cus_N1x2y3z4a5b6 whsec_abc123 /x?token=secret&ok=1"
  );
  for (const leak of ["jane.doe", "abc.def-123", "eyJhbGci", "sk_live_51ABCdef", "cus_N1x2y3z4a5b6", "whsec_abc123", "token=secret"]) {
    assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  }
  assert.ok(out.includes("ok=1"));
});

test("scrubEvent keeps only the internal user id and drops request body/cookies/auth headers", () => {
  const event = scrubEvent({
    message: "failed for bob@example.com",
    user: { id: "u_123", email: "bob@example.com", ip_address: "1.2.3.4", username: "bob" },
    request: {
      url: "https://app.test/api/x?email=bob@example.com",
      data: { answer: "B", question: "What is GAAP?" },
      cookies: { __session: "jwt" },
      headers: { Authorization: "Bearer xyz", Cookie: "a=b", "stripe-signature": "t=1", "User-Agent": "UA" },
    },
    extra: { selectedAnswer: 2, studentAnswer: "C", stripeCustomerId: "cus_123456789", count: 3 },
    contexts: { os: { name: "Windows" }, payload: { content: "essay" } },
    breadcrumbs: [{ message: "POST to a@b.co", data: { body: "{}", url: "/api/x" } }],
    exception: { values: [{ value: "token sk_test_abc for a@b.co", stacktrace: { frames: [{ vars: { password: "x" } }] } }] },
  });

  assert.deepEqual(event.user, { id: "u_123" });
  assert.equal(event.request?.data, undefined);
  assert.equal(event.request?.cookies, undefined);
  assert.deepEqual(event.request?.headers, { "User-Agent": "UA" });
  assert.ok(!String(event.request?.url).includes("bob@"));
  assert.equal((event.extra as Record<string, unknown>).selectedAnswer, FILTERED);
  assert.equal((event.extra as Record<string, unknown>).studentAnswer, FILTERED);
  assert.equal((event.extra as Record<string, unknown>).stripeCustomerId, FILTERED);
  assert.equal((event.extra as Record<string, unknown>).count, 3);
  assert.deepEqual(event.contexts?.os, { name: "Windows" });
  assert.deepEqual(event.contexts?.payload, { content: FILTERED });
  assert.ok(!JSON.stringify(event).includes("@example.com"));
  assert.ok(!JSON.stringify(event).includes("a@b.co"));
  assert.ok(!JSON.stringify(event).includes("sk_test_abc"));
  assert.ok(!JSON.stringify(event).includes("password"));
});
