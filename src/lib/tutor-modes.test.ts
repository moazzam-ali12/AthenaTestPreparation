import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTutorMode,
  isTutorRequestMode,
  parsePracticeIds,
  practiceHref,
  practiceLabel,
  resolveTutorMode,
  withTrailingEvent,
} from "./tutor-modes";

test("default mode: Hint before answering, Full after; a saved choice wins", () => {
  assert.equal(resolveTutorMode(null, false), "hint");
  assert.equal(resolveTutorMode(undefined, true), "full");
  assert.equal(resolveTutorMode("guided", false), "guided");
  assert.equal(resolveTutorMode("hint", true), "hint");
});

test("mode validation", () => {
  assert.ok(isTutorMode("full"));
  assert.ok(!isTutorMode("why_wrong"));
  assert.ok(isTutorRequestMode("why_wrong"));
  assert.ok(!isTutorRequestMode("answer"));
});

test("practice links", () => {
  const id = "0b0e7c1e-2a8f-4a55-9f0c-1234567890ab";
  assert.equal(practiceHref("far", "leases & rent", id), `/learning/far/leases%20%26%20rent/practice?ids=${id}`);
  assert.deepEqual(parsePracticeIds(`${id},nope,${id},${id}`), [id, id]);
  assert.deepEqual(parsePracticeIds(null), []);
  assert.equal(practiceLabel("What is $x$?"), "What is x?");
  assert.equal(practiceLabel("a".repeat(100)).length, 80);
});

test("withTrailingEvent appends one SSE event after the upstream ends", async () => {
  const enc = new TextEncoder();
  const upstream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: {"token":"hi"}\n\n'));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  const out = withTrailingEvent(upstream, async () => ({ practice_links: [{ id: "1" }] }));
  const text = await new Response(out).text();
  assert.equal(text, 'data: {"token":"hi"}\n\ndata: [DONE]\n\ndata: {"practice_links":[{"id":"1"}]}\n\n');

  const none = withTrailingEvent(new Response("x").body!, async () => null);
  assert.equal(await new Response(none).text(), "x");
});
