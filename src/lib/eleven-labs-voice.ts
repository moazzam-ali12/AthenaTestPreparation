const VOICE_COOKIE_NAME = "athena_voice";

/** Pulls the user's chosen voice from the request cookie (set by
 *  TutorCharacterProvider). Returns null when absent. */
function readVoiceCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VOICE_COOKIE_NAME) {
      try {
        return decodeURIComponent(rest.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Resolution order: per-call override (bodyVoiceId) → user's chosen voice
 *  (athena_voice cookie) → env default. Only alphanumeric ids (ElevenLabs
 *  format) are accepted to keep untrusted input out of upstream requests.
 *  Returns null if no env default is configured. */
export function resolveVoiceId(req: Request, bodyVoiceId?: string): string | null {
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!envVoiceId) return null;
  const cookieVoiceId = readVoiceCookie(req);
  const candidate = bodyVoiceId ?? cookieVoiceId ?? envVoiceId;
  return /^[A-Za-z0-9]{8,64}$/.test(candidate) ? candidate : envVoiceId;
}
