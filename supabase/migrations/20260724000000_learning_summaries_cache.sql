-- Cache for LLM-synthesized personalized learning summaries.
-- One row per user. The narrative is regenerated only when the underlying stats
-- change (input_hash differs) or the cached copy is older than the app's TTL,
-- so the progress page doesn't fire an LLM call on every load.
create table if not exists learning_summaries (
  user_id uuid primary key references users(id) on delete cascade,
  input_hash text not null,
  headline text not null,
  narrative jsonb not null,
  generated_at timestamptz not null default now()
);
