import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/queries/users";
import { supabase } from "@/lib/supabase/client";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const EMAIL_FROM = process.env.EMAIL_FROM || "Athena <noreply@yourdomain.com>";

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { email } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const { data: friendUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!friendUser) {
    return NextResponse.json({ error: "User not found with that email" }, { status: 404 });
  }

  if (friendUser.id === user.id) {
    return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 });
  }

  // Check if friendship already exists in either direction
  const { data: existing } = await supabase
    .from("friendships")
    .select("id")
    .or(
      `and(user_id.eq.${user.id},friend_user_id.eq.${friendUser.id}),and(user_id.eq.${friendUser.id},friend_user_id.eq.${user.id})`
    )
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Friend request already exists" }, { status: 409 });
  }

  const { data: friendship } = await supabase
    .from("friendships")
    .insert({
      user_id: user.id,
      friend_user_id: friendUser.id,
      status: "pending",
    })
    .select()
    .single();

  // Fetch invited user's email to send notification
  const { data: invitedUser } = await supabase
    .from("users")
    .select("email, display_name")
    .eq("id", friendUser.id)
    .single();

  if (invitedUser?.email) {
    const senderName = user.displayName || "Someone";
    await resend.emails.send({
      from: EMAIL_FROM,
      to: [invitedUser.email],
      subject: `${senderName} invited you to compete on Athena!`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div style="padding:40px 32px;text-align:center;">
            <h1 style="margin:0 0 16px;font-size:24px;color:#111827;">You've been challenged!</h1>
            <p style="margin:0 0 24px;font-size:16px;color:#4b5563;line-height:1.6;">
              <strong>${senderName}</strong> invited you to compete on Athena CPA Exam Prep. Accept the challenge and see who's more exam-ready!
            </p>
            <a href="${APP_URL}/dashboard" style="display:inline-block;padding:12px 32px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">
              View Challenge
            </a>
          </div>
        </div>
      `,
    }).catch(() => null); // don't fail the request if email fails
  }

  return NextResponse.json({ friendship });
}
