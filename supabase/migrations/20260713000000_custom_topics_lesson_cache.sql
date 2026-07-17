-- Cache generated My Learning (custom-topic) micro-lessons and practice
-- problems on the custom_topics row so they are generated once and reused,
-- instead of re-calling the (expensive) agents backend on every visit.
--
-- Additive only: all columns nullable, no defaults, no drops, no constraints
-- that rewrite/lock existing rows. Safe to run on a live table.

alter table custom_topics
  add column if not exists micro_lesson_status     text,
  add column if not exists micro_lesson_content    text,
  add column if not exists micro_lesson_steps       jsonb,
  add column if not exists micro_lesson_updated_at  timestamptz,
  add column if not exists practice_problems        jsonb;
