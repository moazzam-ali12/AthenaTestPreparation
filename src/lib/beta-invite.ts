// Pure beta-invite helpers (no DB / Clerk imports, so they unit-test cleanly).

/** httpOnly cookie that carries a validated ?invite= code from /sign-up to the first /api/user/sync. */
export const INVITE_COOKIE = "athena_beta_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24; // 1 day to finish sign-up

export type InviteStatus = "ok" | "invalid" | "expired" | "used_up";
export type RedeemResult = InviteStatus | "already_beta";

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9_-]{4,64}$/.test(code) ? code : null;
}

export type InviteRow = { code: string; max_uses: number; used: number; expires_at: string | null };

export function inviteStatus(row: InviteRow | null, now = new Date()): InviteStatus {
  if (!row) return "invalid";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (row.used >= row.max_uses) return "used_up";
  return "ok";
}

export const INVITE_ERROR_COPY: Record<Exclude<InviteStatus, "ok">, string> = {
  invalid: "That invite code isn't valid.",
  expired: "That invite code has expired.",
  used_up: "That invite code has already been used up.",
};

