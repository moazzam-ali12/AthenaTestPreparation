// Admin access. Admins are users with users.is_admin = true (see
// supabase/migrations/20261118100000_admin_panel.sql). Checked twice: in
// src/middleware.ts for every /admin page and /api/admin route, and again in
// each admin route/page on the server. Non-admins always get a plain 404.
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

// is_admin / admin tables are newer than the generated Supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adminDb = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: object) => any };

export type AdminUser = { id: string; email: string };

/** True only for a synced user row with is_admin = true. Fails closed. */
export async function isAdminClerkId(clerkId: string): Promise<boolean> {
  const { data, error } = await adminDb
    .from("users")
    .select("is_admin")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (error) {
    console.error("Admin check failed:", error.message);
    return false;
  }
  return data?.is_admin === true;
}

/** The signed-in admin, or null for anyone else (signed out, not synced, not admin). */
export async function getAdmin(): Promise<AdminUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const { data, error } = await adminDb
    .from("users")
    .select("id, email, is_admin")
    .eq("clerk_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Admin check failed:", error.message);
    return null;
  }
  return data?.is_admin === true ? { id: data.id, email: data.email } : null;
}

export function notFoundJson() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export class AdminInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Wraps an admin route handler: 404 for non-admins, 400 for AdminInputError,
 * 500 (without details) for anything else.
 */
export function adminRoute<Ctx>(handler: (req: Request, ctx: Ctx, admin: AdminUser) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const admin = await getAdmin();
    if (!admin) return notFoundJson();
    try {
      return await handler(req, ctx, admin);
    } catch (err) {
      if (err instanceof AdminInputError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      console.error("Admin route failed:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AdminInputError("Invalid JSON");
  }
}
