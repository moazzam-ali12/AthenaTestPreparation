import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminInputError, adminDb, adminRoute, readJson } from "@/lib/admin/auth";
import { audited } from "@/lib/admin/audit";
import { normalizeInviteCode } from "@/lib/beta-invite";

const BodySchema = z.object({
  code: z.string().optional(),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().max(200).optional(),
});

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `BETA-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

// Admin-only: create an invite code (random BETA-XXXXXXXX unless one is given).
export const POST = adminRoute(async (req: Request, _ctx: unknown, admin) => {
  const parsed = BodySchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AdminInputError("Invalid invite");

  const code = parsed.data.code ? normalizeInviteCode(parsed.data.code) : randomCode();
  if (!code) throw new AdminInputError("Code must be 4–64 letters, digits, - or _");

  const row = {
    code,
    max_uses: parsed.data.maxUses,
    expires_at: parsed.data.expiresAt ?? null,
    note: parsed.data.note ?? null,
  };
  const invite = await audited(admin, { action: "beta_invite.create", targetType: "beta_invite", targetId: code, after: row }, async () => {
    const { data, error } = await adminDb.from("beta_invites").insert(row).select().single();
    if (error?.code === "23505") throw new AdminInputError("Code already exists", 409);
    if (error) throw new Error(error.message);
    return data;
  });
  return NextResponse.json({ invite }, { status: 201 });
});
