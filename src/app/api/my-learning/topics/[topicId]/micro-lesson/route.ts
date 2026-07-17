import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";
import { getUserByClerkId } from "@/lib/db/queries/users";
import type { WhiteboardStep } from "@/types/whiteboard";

/**
 * Cache + generation lock for "My Learning" custom-topic micro-lessons.
 * Mirrors the ACT flow (src/app/api/learning/.../micro-lesson/route.ts) so a
 * lesson is generated once, persisted, and reused on every subsequent visit
 * instead of regenerating on the (expensive) agents backend each mount.
 *
 * Cache lives on custom_topics columns:
 *   micro_lesson_status ('generating' | 'ready'), micro_lesson_content (text),
 *   micro_lesson_steps (jsonb), micro_lesson_updated_at (timestamptz).
 */

async function resolveOwnedTopic(topicId: string, clerkId: string) {
  const user = await getUserByClerkId(clerkId);
  if (!user) return null;

  const { data: topic } = await supabase
    .from("custom_topics")
    .select("id, user_id, micro_lesson_status, micro_lesson_content, micro_lesson_steps, micro_lesson_updated_at")
    .eq("id", topicId)
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  return topic ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicId } = await params;
  const topic = await resolveOwnedTopic(topicId, clerkId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!topic.micro_lesson_status) {
    return NextResponse.json(null);
  }

  // Generating but stale (> 10 min) → treat as stale so a new client can take over.
  if (topic.micro_lesson_status === "generating") {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    if (topic.micro_lesson_updated_at && new Date(topic.micro_lesson_updated_at) < tenMinutesAgo) {
      return NextResponse.json({ status: "stale" });
    }
  }

  return NextResponse.json({
    id: topic.id,
    status: topic.micro_lesson_status,
    lessonContent: topic.micro_lesson_content ?? "",
    whiteboardSteps: topic.micro_lesson_steps ?? [],
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicId } = await params;
  const topic = await resolveOwnedTopic(topicId, clerkId);
  if (!topic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();

  if (body.action === "start") {
    // Fresh 'generating' lock held by another client → don't acquire.
    if (topic.micro_lesson_status === "generating") {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const fresh = topic.micro_lesson_updated_at && new Date(topic.micro_lesson_updated_at) >= tenMinutesAgo;
      if (fresh) return NextResponse.json({ acquired: false });
    }
    // Already ready → no need to regenerate.
    if (topic.micro_lesson_status === "ready" && topic.micro_lesson_content) {
      return NextResponse.json({ acquired: false });
    }

    await supabase
      .from("custom_topics")
      .update({ micro_lesson_status: "generating", micro_lesson_updated_at: new Date().toISOString() })
      .eq("id", topicId);

    return NextResponse.json({ acquired: true });
  }

  if (body.action === "save") {
    const { lessonContent, whiteboardSteps } = body as {
      lessonContent: string;
      whiteboardSteps: WhiteboardStep[];
    };

    await supabase
      .from("custom_topics")
      .update({
        micro_lesson_status: "ready",
        micro_lesson_content: lessonContent,
        micro_lesson_steps: whiteboardSteps,
        micro_lesson_updated_at: new Date().toISOString(),
      })
      .eq("id", topicId);

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
