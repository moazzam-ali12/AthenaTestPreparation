-- Daily AI-tutor message cap for free-trial users.
-- The cap itself lives in src/lib/trial.ts (TUTOR_MESSAGES_PER_DAY_TRIAL).
--
-- A small dedicated counter table instead of reusing trial_usage: trial_usage
-- is a "distinct items ever opened" ledger (section NOT NULL, unique item_id),
-- while this is a per-day counter. One row per (user, kind, UTC day).

CREATE TABLE IF NOT EXISTS trial_daily_usage (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('tutor_msg')),
  usage_date DATE NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trial_daily_usage_pkey PRIMARY KEY (user_id, kind, usage_date)
);

-- Same RLS as trial_usage: users read their own rows; writes are server-only.
ALTER TABLE trial_daily_usage ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trial_daily_usage' AND policyname = 'Users can read own trial daily usage'
  ) THEN
    CREATE POLICY "Users can read own trial daily usage" ON trial_daily_usage
      FOR SELECT
      USING (user_id IN (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

-- Atomic check-and-increment for today's (UTC) counter. The upsert takes a
-- row lock, so concurrent calls serialise and can never push `used` past p_max.
CREATE OR REPLACE FUNCTION consume_trial_daily(
  p_user_id UUID,
  p_kind    TEXT,
  p_max     INTEGER
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, usage_day DATE)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_day  DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_used INTEGER;
BEGIN
  IF p_max <= 0 THEN
    RETURN QUERY SELECT FALSE, 0, v_day;
    RETURN;
  END IF;

  INSERT INTO trial_daily_usage AS t (user_id, kind, usage_date, used)
  VALUES (p_user_id, p_kind, v_day, 1)
  ON CONFLICT ON CONSTRAINT trial_daily_usage_pkey DO UPDATE
    SET used = t.used + 1, updated_at = NOW()
    WHERE t.used < p_max
  RETURNING t.used INTO v_used;

  -- No row returned: today's counter is already at the cap.
  IF v_used IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, v_day;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, p_max - v_used, v_day;
END;
$$;

-- Gives back one unit (e.g. the LLM call failed). p_day is the usage_day that
-- consume_trial_daily returned, so a refund just after midnight hits the right row.
CREATE OR REPLACE FUNCTION refund_trial_daily(
  p_user_id UUID,
  p_kind    TEXT,
  p_day     DATE
)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE trial_daily_usage
  SET used = used - 1, updated_at = NOW()
  WHERE user_id = p_user_id AND kind = p_kind AND usage_date = p_day AND used > 0;
$$;

-- Only the server (service role) may consume or refund quota.
REVOKE ALL ON FUNCTION consume_trial_daily(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION refund_trial_daily(UUID, TEXT, DATE) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION consume_trial_daily(UUID, TEXT, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION refund_trial_daily(UUID, TEXT, DATE) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
