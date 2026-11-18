-- Idempotency ledger for Stripe webhook events. The event id is the primary key,
-- so a re-delivered event fails the insert and is skipped instead of reprocessed.
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
