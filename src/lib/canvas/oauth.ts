import type { CanvasIntegration } from "@/lib/db/queries/canvas";

const CLIENT_ID = process.env.CANVAS_CLIENT_ID!;
const CLIENT_SECRET = process.env.CANVAS_CLIENT_SECRET!;

function getRedirectUri(): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/canvas/oauth/callback`;
}

export function buildCanvasAuthUrl(canvasInstanceUrl: string, state: string): string {
  const base = canvasInstanceUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    state,
  });
  return `${base}/login/oauth2/auth?${params}`;
}

export async function exchangeCodeForTokens(
  canvasInstanceUrl: string,
  code: string
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  canvasUserId: string;
  canvasUserName: string;
  canvasUserEmail: string;
}> {
  const base = canvasInstanceUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/login/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: getRedirectUri(),
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Canvas token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? null,
    tokenExpiresAt: data.expires_in
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : null,
    canvasUserId: String((data.user as { id: number })?.id ?? ""),
    canvasUserName: (data.user as { name: string })?.name ?? "",
    canvasUserEmail: (data.user as { global_id: string })?.global_id ?? "",
  };
}

export async function refreshCanvasToken(integration: CanvasIntegration): Promise<{
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}> {
  if (!integration.refreshToken) throw new Error("No refresh token available");

  const base = integration.canvasInstanceUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/login/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: getRedirectUri(),
      refresh_token: integration.refreshToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Canvas token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? integration.refreshToken,
    tokenExpiresAt: data.expires_in
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : null,
  };
}

export function encodeState(canvasUrl: string): string {
  return Buffer.from(JSON.stringify({ canvasUrl, ts: Date.now() })).toString("base64url");
}

export function decodeState(state: string): { canvasUrl: string } {
  const decoded = JSON.parse(Buffer.from(state, "base64url").toString()) as {
    canvasUrl: string;
    ts: number;
  };
  if (Date.now() - decoded.ts > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }
  return { canvasUrl: decoded.canvasUrl };
}
