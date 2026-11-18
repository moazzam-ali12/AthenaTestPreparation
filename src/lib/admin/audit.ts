import { adminDb, type AdminUser } from "./auth";

export type AuditEntry = {
  action: string;
  targetType: "problem" | "tbs" | "user" | "beta_invite" | "feedback";
  targetId: string;
  before?: unknown;
  after?: unknown;
};

/**
 * Runs an admin write with its audit entry. The entry is inserted first and
 * removed again if the write fails, so no write can happen without a log row.
 */
export async function audited<T>(admin: AdminUser, entry: AuditEntry, write: () => Promise<T>): Promise<T> {
  const { data, error } = await adminDb
    .from("admin_audit_log")
    .insert({
      admin_id: admin.id,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`admin_audit_log insert failed: ${error?.message}`);

  try {
    return await write();
  } catch (err) {
    const { error: undoError } = await adminDb.from("admin_audit_log").delete().eq("id", data.id);
    if (undoError) console.error("Failed to remove audit entry of a failed write:", undoError.message);
    throw err;
  }
}

/** Only the keys whose values differ, as { before, after } snapshots. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(patch[key])) {
      b[key] = before[key];
      a[key] = patch[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

export async function recentAudit(targetType: AuditEntry["targetType"], targetId: string, limit = 20) {
  const { data, error } = await adminDb
    .from("admin_audit_log")
    .select("id, action, before, after, created_at, users!admin_audit_log_admin_id_fkey(email)")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`admin_audit_log read failed: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    action: string;
    before: unknown;
    after: unknown;
    created_at: string;
    users: { email: string } | null;
  }[]).map((r) => ({
    id: r.id,
    action: r.action,
    before: r.before,
    after: r.after,
    createdAt: r.created_at,
    adminEmail: r.users?.email ?? null,
  }));
}
