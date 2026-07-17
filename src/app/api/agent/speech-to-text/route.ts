import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ElevenLabs not configured" },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as Blob | null;
    if (!audio) {
      return NextResponse.json(
        { error: "No audio provided" },
        { status: 400 }
      );
    }

    const body = new FormData();
    body.append("file", audio, "recording.webm");
    body.append("model_id", "scribe_v1");
    // Non-speech sounds (traffic, background noise, etc.) would otherwise be
    // annotated inline as e.g. "(traffic noise)" and get sent to the tutor
    // as if the student had said it.
    body.append("tag_audio_events", "false");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error(`ElevenLabs STT error ${res.status}:`, body);
      const detail = body?.detail ?? {};
      return NextResponse.json(
        { error: "Speech-to-text failed", detail },
        { status: 503 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text });
  } catch (err) {
    console.error("STT route error:", err);
    return NextResponse.json(
      { error: "Speech-to-text failed" },
      { status: 503 }
    );
  }
}
