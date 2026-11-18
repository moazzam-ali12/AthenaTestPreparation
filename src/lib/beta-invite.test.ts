import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteStatus, normalizeInviteCode } from "./beta-invite";

const now = new Date("2026-11-17T12:00:00Z");
const row = (o: Partial<{ max_uses: number; used: number; expires_at: string | null }> = {}) => ({
  code: "BETA-1",
  max_uses: 10,
  used: 0,
  expires_at: null,
  ...o,
});

test("normalizeInviteCode upper-cases, trims and rejects junk", () => {
  assert.equal(normalizeInviteCode("  beta-2026 "), "BETA-2026");
  assert.equal(normalizeInviteCode("ab"), null);
  assert.equal(normalizeInviteCode("bad code!"), null);
  assert.equal(normalizeInviteCode(undefined), null);
});

test("inviteStatus: ok / invalid / expired / used_up", () => {
  assert.equal(inviteStatus(row(), now), "ok");
  assert.equal(inviteStatus(null, now), "invalid");
  assert.equal(inviteStatus(row({ expires_at: "2026-11-17T11:59:59Z" }), now), "expired");
  assert.equal(inviteStatus(row({ expires_at: "2026-11-18T00:00:00Z" }), now), "ok");
  assert.equal(inviteStatus(row({ used: 10 }), now), "used_up");
  assert.equal(inviteStatus(row({ used: 9 }), now), "ok");
});
