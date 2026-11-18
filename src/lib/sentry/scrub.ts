/**
 * PII / secret scrubbing for every Sentry event (browser, Node and edge).
 *
 * Pure functions with no Sentry import, so they are unit-testable and safe to
 * load in every runtime. Wired up through `beforeSend`, `beforeSendTransaction`
 * and `beforeBreadcrumb` in `src/lib/sentry/options.ts`.
 *
 * Policy:
 *  - user: only the internal user id survives (no email, IP, username).
 *  - request: body and cookies are dropped; only harmless headers are kept.
 *  - any key that looks like a secret, contact detail or learner content
 *    (answers, questions, chat messages, prompts…) is replaced by "[Filtered]".
 *  - free-text strings get emails, bearer tokens, JWTs and Stripe keys/ids masked.
 */

export const FILTERED = "[Filtered]";

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|auth|cookie|session|api[-_]?key|signature|stripe|card|cvc|iban|email|e-mail|phone|address|answer|question|option|solution|explanation|prompt|content|message|history|transcript|body|payload|svix|dsn|jwt|credential|private/i;

// Headers that are safe and useful for debugging; everything else is dropped.
const SAFE_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "content-length",
  "host",
  "user-agent",
  "x-forwarded-proto",
  "x-vercel-id",
  "sentry-trace",
  "baggage",
]);

// Standard Sentry contexts produced by the SDK itself; left untouched.
const SAFE_CONTEXTS = new Set([
  "os",
  "browser",
  "runtime",
  "device",
  "app",
  "trace",
  "culture",
  "cloud_resource",
  "nextjs",
  "otel",
  "react",
]);

const STRING_RULES: Array<[RegExp, string]> = [
  // Emails
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // Authorization: Bearer / Basic …
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 [Filtered]"],
  // JWTs (Clerk session tokens, Supabase keys)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  // Stripe secret / publishable / restricted keys and webhook secrets
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, "[stripe-key]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[Filtered]"],
  // Stripe object ids (customers, subscriptions, payments, sessions, …)
  [/\b(cus|sub|pi|ch|cs_(live|test)|in|pm|seti|evt|price|prod|bps)_[A-Za-z0-9]{8,}/g, "[stripe-id]"],
  // Supabase service keys / Anthropic / OpenAI / Resend style keys
  [/\b(sb_secret|sb_publishable|sk-ant|sk-proj|re)_[A-Za-z0-9_-]{10,}/g, "[Filtered]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[Filtered]"],
  // Sensitive query params: ?token=…&code=…
  [/([?&](?:token|code|key|secret|signature|sig|password|email|access_token|refresh_token|__clerk_[a-z_]+)=)[^&#\s]*/gi, "$1[Filtered]"],
];

export function scrubString(value: string): string {
  let out = value;
  for (const [re, replacement] of STRING_RULES) out = out.replace(re, replacement);
  return out;
}

/** Recursively mask sensitive keys and scrub every string value. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return FILTERED;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? FILTERED : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/* Minimal structural types so this file stays independent of @sentry/* types. */
type Obj = Record<string, unknown>;
interface ScrubbableEvent {
  message?: string;
  transaction?: string;
  user?: Obj;
  request?: Obj;
  extra?: Obj;
  contexts?: Obj;
  breadcrumbs?: Array<Obj>;
  exception?: { values?: Array<Obj> };
  spans?: Array<Obj>;
  logentry?: Obj;
  tags?: Obj;
}

function scrubHeaders(headers: unknown): Obj | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const out: Obj = {};
  for (const [k, v] of Object.entries(headers as Obj)) {
    if (SAFE_HEADERS.has(k.toLowerCase())) out[k] = typeof v === "string" ? scrubString(v) : v;
  }
  return out;
}

export function scrubBreadcrumb<T extends object>(crumb: T): T {
  const c: Obj = { ...(crumb as Obj) };
  if (typeof c.message === "string") c.message = scrubString(c.message);
  if (c.data) c.data = scrubValue(c.data);
  return c as T;
}

export function scrubEvent<T extends object>(event: T): T {
  const e = event as unknown as ScrubbableEvent;

  // Only the internal user id may leave the app.
  if (e.user) {
    const id = e.user.id;
    e.user = id !== undefined && id !== null ? { id: String(id) } : undefined;
  }

  if (e.request) {
    const r = e.request;
    delete r.data;
    delete r.cookies;
    delete r.env;
    r.headers = scrubHeaders(r.headers);
    if (typeof r.url === "string") r.url = scrubString(r.url);
    if (typeof r.query_string === "string") r.query_string = scrubString(r.query_string);
    else if (r.query_string) r.query_string = scrubValue(r.query_string);
  }

  if (typeof e.message === "string") e.message = scrubString(e.message);
  if (typeof e.transaction === "string") e.transaction = scrubString(e.transaction);
  if (e.logentry) e.logentry = scrubValue(e.logentry) as Obj;
  if (e.extra) e.extra = scrubValue(e.extra) as Obj;
  if (e.tags) e.tags = scrubValue(e.tags) as Obj;

  if (e.contexts) {
    const ctx: Obj = {};
    for (const [k, v] of Object.entries(e.contexts)) {
      ctx[k] = SAFE_CONTEXTS.has(k) ? v : scrubValue(v);
    }
    e.contexts = ctx;
  }

  for (const ex of e.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    const frames = (ex.stacktrace as { frames?: Array<Obj> } | undefined)?.frames;
    for (const f of frames ?? []) delete f.vars;
  }

  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((c) => scrubBreadcrumb(c));

  for (const s of e.spans ?? []) {
    if (typeof s.description === "string") s.description = scrubString(s.description);
    if (s.data) s.data = scrubValue(s.data);
  }

  return event;
}
