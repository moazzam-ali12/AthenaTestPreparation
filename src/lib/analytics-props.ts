// Pure helpers for product analytics (no DB / Next imports, so they unit-test cleanly).

export const EVENT_NAMES = [
  "signup",
  "onboarding_done",
  "diagnostic_done",
  "quest_started",
  "quest_completed",
  "tutor_used",
  "paywall_viewed",
  "checkout_started",
  "subscribed",
  "churned",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Events the browser may report via POST /api/events (everything else is server-only). */
export const CLIENT_EVENT_NAMES: readonly EventName[] = ["paywall_viewed"];

export function isEventName(v: unknown): v is EventName {
  return typeof v === "string" && (EVENT_NAMES as readonly string[]).includes(v);
}

export type EventProps = Record<string, string | number | boolean | null>;

const PII_TOKENS = new Set([
  "email", "mail", "name", "firstname", "lastname", "fullname", "username", "phone", "mobile",
  "address", "ip", "token", "password", "card", "ssn", "dob", "birthday", "message", "text",
  "content", "url", "href", "ua", "agent",
]);
/** camelCase/snake_case key → lowercase tokens; true if any token looks like PII. */
function isPiiKey(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split("_")
    .some((t) => PII_TOKENS.has(t));
}
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const MAX_KEYS = 12;
const MAX_STRING = 64;

/**
 * Keep only small, flat, non-identifying props: primitive values, no PII-looking keys,
 * no email/phone-looking strings, short strings only. Anything else is dropped silently.
 */
export function sanitizeProps(props: unknown): EventProps {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  const out: EventProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key) || isPiiKey(key)) continue;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") {
      if (value.length > MAX_STRING || EMAIL.test(value) || PHONE.test(value)) continue;
      out[key] = value;
    }
  }
  return out;
}
