// Quiz-tutor modes shared by the tutor UI, the quiz-chat route and the preferences route.

export const TUTOR_MODES = ["hint", "guided", "full"] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];
/** What the quiz-chat route accepts: a selectable mode, or the one-shot "Why was I wrong?" analysis. */
export type TutorRequestMode = TutorMode | "why_wrong";

export const TUTOR_MODE_LABELS: Record<TutorMode, string> = {
  hint: "Hint",
  guided: "Guided",
  full: "Full explanation",
};

export function isTutorMode(v: unknown): v is TutorMode {
  return typeof v === "string" && (TUTOR_MODES as readonly string[]).includes(v);
}

export function isTutorRequestMode(v: unknown): v is TutorRequestMode {
  return v === "why_wrong" || isTutorMode(v);
}

/** The user's saved choice wins; otherwise Hint before answering, Full explanation after. */
export function resolveTutorMode(saved: TutorMode | null | undefined, answered: boolean): TutorMode {
  if (saved) return saved;
  return answered ? "full" : "hint";
}

export type PracticeLink = { id: string; label: string; href: string };

/** Link to one practice question of a subtopic (rendered by the subtopic practice page). */
export function practiceHref(topicSlug: string, subtopicSlug: string, problemId: string): string {
  return `/learning/${encodeURIComponent(topicSlug)}/${encodeURIComponent(subtopicSlug)}/practice?ids=${encodeURIComponent(problemId)}`;
}

/** `?ids=a,b` → at most 2 well-formed ids. */
export function parsePracticeIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 2);
}

/** Trims a question into a short link label. */
export function practiceLabel(questionText: string, max = 80): string {
  const plain = questionText.replace(/\$+/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Appends one `data: {...}` SSE event after an upstream SSE body ends (e.g. practice links). */
export function withTrailingEvent(
  body: ReadableStream<Uint8Array>,
  event: () => Promise<Record<string, unknown> | null>
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const { done, value } = await reader.read();
      if (!done) {
        controller.enqueue(value);
        return;
      }
      finished = true;
      const payload = await event().catch(() => null);
      if (payload) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
