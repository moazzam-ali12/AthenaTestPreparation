import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeTutorMessage, refundOnStreamError } from "./tutor-cap";

const encoder = new TextEncoder();

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += new TextDecoder().decode(value);
  }
}

test("a stream that completes is not refunded", async () => {
  let refunds = 0;
  const upstream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode("data: hi\n\n"));
      c.close();
    },
  });
  const text = await drain(refundOnStreamError(upstream, async () => void refunds++));
  assert.equal(text, "data: hi\n\n");
  assert.equal(refunds, 0);
});

test("a stream that fails mid-way refunds the message", async () => {
  let refunds = 0;
  let sent = false;
  const upstream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        c.enqueue(encoder.encode("data: partial\n\n"));
      } else {
        c.error(new Error("upstream died"));
      }
    },
  });
  await assert.rejects(drain(refundOnStreamError(upstream, async () => void refunds++)), /upstream died/);
  assert.equal(refunds, 1);
});

test("pro, expired and unknown users are never charged", async () => {
  const past = new Date(Date.now() - 86_400_000);
  for (const user of [
    null,
    { id: "u1", subscriptionStatus: "active", trialEndsAt: past, createdAt: past },
    { id: "u2", subscriptionStatus: "free", trialEndsAt: past, createdAt: past },
  ]) {
    // No DB call happens for these (the Supabase client is never touched).
    const charge = await chargeTutorMessage(user);
    assert.equal(charge.blocked, null);
  }
});
