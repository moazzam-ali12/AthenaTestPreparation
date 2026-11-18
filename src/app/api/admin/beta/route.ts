import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { adminDb, adminRoute } from "@/lib/admin/auth";

type FunnelRow = { step: string; users: number };

// Admin-only overview for /admin/beta: invites, recent feedback, funnel counts.
export const GET = adminRoute(async () => {
  const [invites, feedback, funnelAll, funnelBeta, betaUsers] = await Promise.all([
    adminDb.from("beta_invites").select("*").order("created_at", { ascending: false }),
    adminDb
      .from("feedback")
      .select(
        "id, type, message, screenshot_path, page_url, user_agent, app_version, sentry_event_id, status, created_at, users(email, cohort)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    adminDb.rpc("beta_funnel", { p_cohort: null }),
    adminDb.rpc("beta_funnel", { p_cohort: "beta" }),
    adminDb.from("users").select("id", { count: "exact", head: true }).eq("cohort", "beta"),
  ]);

  const failed = [invites, feedback, funnelAll, funnelBeta, betaUsers].find((r) => r.error);
  if (failed) throw new Error(`admin/beta load failed: ${failed.error.message}`);

  // Screenshots live in a private bucket: hand out short-lived signed URLs.
  type FeedbackRow = Record<string, unknown> & { screenshot_path: string | null };
  const rows = (feedback.data ?? []) as FeedbackRow[];
  const paths = rows.map((f) => f.screenshot_path).filter((p): p is string => !!p);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from("feedback").createSignedUrls(paths, 60 * 60);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }

  return NextResponse.json({
    invites: invites.data ?? [],
    feedback: rows.map((f) => ({
      ...f,
      screenshot_url: f.screenshot_path ? (signed.get(f.screenshot_path) ?? null) : null,
    })),
    funnel: {
      all: (funnelAll.data ?? []) as FunnelRow[],
      beta: (funnelBeta.data ?? []) as FunnelRow[],
    },
    betaUserCount: betaUsers.count ?? 0,
  });
});
