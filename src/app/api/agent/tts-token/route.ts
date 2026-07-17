import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { resolveVoiceId } from "@/lib/eleven-labs-voice";

/** Mints a short-lived (15 min) ElevenLabs token so the browser can open a
 *  direct WebSocket connection to the streaming TTS endpoint without ever
 *  seeing the real API key. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !envVoiceId) {
    return NextResponse.json(
      { error: "ElevenLabs not configured" },
      { status: 500 }
    );
  }

  const voiceId = resolveVoiceId(req) ?? envVoiceId;

  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/tts_websocket",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey },
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`ElevenLabs token error ${res.status}:`, body);
      return NextResponse.json(
        { error: "Could not create TTS session" },
        { status: 503 }
      );
    }

    const { token } = (await res.json()) as { token: string };
    return NextResponse.json({ token, voiceId });
  } catch (err) {
    console.error("TTS token route error:", err);
    return NextResponse.json(
      { error: "Could not create TTS session" },
      { status: 503 }
    );
  }
}
