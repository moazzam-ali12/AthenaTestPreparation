-- Ensure the webhook idempotency ledger exists (20260720010000 was never applied).
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lock every public table to the service role. The Next.js server and the agents
-- backend both connect with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS; with no
-- policies defined, the anon/publishable key can no longer read or write anything
-- (e.g. a user setting their own plan_type = 'pro').
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
