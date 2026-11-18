// Beta launch helpers: invite codes. Server-only (uses the service-role client).
import { supabase } from "@/lib/supabase/client";
import {
  inviteStatus,
  normalizeInviteCode,
  type InviteRow,
  type InviteStatus,
  type RedeemResult,
} from "./beta-invite";

export * from "./beta-invite";

/** Read-only check (does not consume a use). */
export async function checkInvite(rawCode: unknown): Promise<InviteStatus> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return "invalid";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("beta_invites")
    .select("code, max_uses, used, expires_at")
    .eq("code", code)
    .maybeSingle();
  return inviteStatus(data as InviteRow | null);
}

/** Atomically consume one use and tag the user as cohort 'beta' (re-checks expiry/uses under a row lock). */
export async function redeemInvite(rawCode: unknown, userId: string): Promise<RedeemResult> {
  const code = normalizeInviteCode(rawCode);
  if (!code) return "invalid";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("redeem_beta_invite", { p_code: code, p_user_id: userId });
  if (error) {
    console.error("redeem_beta_invite failed:", error.message);
    return "invalid";
  }
  return data as RedeemResult;
}
