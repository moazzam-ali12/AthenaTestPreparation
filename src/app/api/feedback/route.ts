import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";

const FEEDBACK_TYPES = ["bug", "confusing", "idea"] as const;
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const SCREENSHOT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PER_HOUR = 10;

const FieldsSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  message: z.string().trim().min(1).max(5000),
  pageUrl: z.string().max(2000).optional(),
  sentryEventId: z.string().regex(/^[a-f0-9]{32}$/i).optional(),
});

function appVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    "dev"
  );
}

/** Same-origin path + query only (drops host and hash). */
function cleanPageUrl(raw: string | undefined, origin: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, origin);
    return `${u.pathname}${u.search}`.slice(0, 2000);
  } catch {
    return null;
  }
}

// POST multipart/form-data: type, message, pageUrl?, sentryEventId?, screenshot? (image ≤ 3 MB).
// user_id always comes from the Clerk session — a user can only file feedback as themselves.
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await getUserByClerkId(clerkId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const parsed = FieldsSchema.safeParse({
    type: str("type"),
    message: str("message"),
    pageUrl: str("pageUrl"),
    sentryEventId: str("sentryEventId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { count } = await db
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_HOUR) {
    return NextResponse.json({ error: "Too much feedback — try again in a bit." }, { status: 429 });
  }

  let screenshotPath: string | null = null;
  const file = form.get("screenshot");
  if (file instanceof File && file.size > 0) {
    const ext = SCREENSHOT_TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "Screenshot must be PNG, JPEG, WebP or GIF" }, { status: 400 });
    if (file.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: "Screenshot must be 3 MB or smaller" }, { status: 400 });
    }
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("feedback")
      .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    // A failed screenshot upload shouldn't lose the written feedback.
    if (upErr) console.error("feedback screenshot upload failed:", upErr.message);
    else screenshotPath = path;
  }

  const { data, error } = await db
    .from("feedback")
    .insert({
      user_id: user.id,
      type: parsed.data.type,
      message: parsed.data.message,
      screenshot_path: screenshotPath,
      page_url: cleanPageUrl(parsed.data.pageUrl, new URL(req.url).origin),
      user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
      app_version: appVersion(),
      sentry_event_id: parsed.data.sentryEventId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("feedback insert failed:", error.message);
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
