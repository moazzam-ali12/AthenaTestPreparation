-- Per-wrong-option misconception hints. Shape: [{ optionIndex, misconception, hint }].
-- Existing rows default to '[]' and fall back to the flat hint/detailed_hint columns.
alter table problems add column if not exists option_hints jsonb default '[]';
