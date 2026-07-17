/**
 * Chat history is re-sent to the LLM on every turn, so its token cost grows
 * unbounded over a long session. Trim to the last N turns (a turn ≈ one
 * user + one assistant message) to cap per-turn input cost while preserving
 * recent tutoring continuity. Stable lesson/system context is sent separately
 * and is NOT part of `history`, so trimming here never drops it.
 */
export const MAX_CHAT_HISTORY_TURNS = 10;

export function trimHistory<T>(history: T[], maxTurns = MAX_CHAT_HISTORY_TURNS): T[] {
  const maxMessages = maxTurns * 2;
  return history.length > maxMessages ? history.slice(-maxMessages) : history;
}
