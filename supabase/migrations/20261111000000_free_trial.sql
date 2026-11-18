-- 7-day, no-card, app-side free trial (no Stripe trial period involved).
-- Limits live in src/lib/trial.ts; this migration only stores dates + usage.
-- Nothing here deletes or resets user data: when a trial ends, every progress
-- row stays put and is visible again the moment the user subscribes.

-- ── 1. Trial window on users ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Defaults apply to new signups only (set after ADD COLUMN so existing rows
-- are not silently backfilled — see the explicit backfill block below).
ALTER TABLE users ALTER COLUMN trial_started_at SET DEFAULT NOW();
ALTER TABLE users ALTER COLUMN trial_ends_at SET DEFAULT (NOW() + INTERVAL '7 days');

-- ── 2. BACKFILL (optional policy — delete this block to opt out) ───────────
-- Gives every existing NON-Pro user a fresh 7-day trial starting today.
-- Without it, src/lib/subscription.ts falls back to created_at + 7 days, so
-- older free accounts would land straight in the "expired" tier.
UPDATE users
SET trial_started_at = NOW(),
    trial_ends_at    = NOW() + INTERVAL '7 days'
WHERE trial_ends_at IS NULL
  AND subscription_status NOT IN ('active', 'trialing');
-- ── END BACKFILL ────────────────────────────────────────────────────────────

-- ── 3. Trial usage ledger ───────────────────────────────────────────────────
-- One row per distinct item a trial user has opened. Retrying / re-opening the
-- same item never uses more quota (unique on user + kind + item).
CREATE TABLE IF NOT EXISTS trial_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('aud', 'far', 'reg', 'bar', 'isc', 'tcp')),
  kind       TEXT NOT NULL CHECK (kind IN ('mcq', 'tbs', 'sample_test')),
  item_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trial_usage_user_kind_item_unique UNIQUE (user_id, kind, item_id)
);

CREATE INDEX IF NOT EXISTS trial_usage_user_kind_section_idx
  ON trial_usage (user_id, kind, section);

-- Users may read their own rows (Clerk JWT `sub` = users.clerk_id). There are
-- no write policies: inserts only happen server-side via the service role.
ALTER TABLE trial_usage ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trial_usage' AND policyname = 'Users can read own trial usage'
  ) THEN
    CREATE POLICY "Users can read own trial usage" ON trial_usage
      FOR SELECT
      USING (user_id IN (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;

-- ── 4. Atomic check-and-consume ─────────────────────────────────────────────
-- Quota scope: 'mcq' and 'tbs' count per section; 'sample_test' counts across
-- the whole account. A per-(user, kind[, section]) advisory lock serialises
-- concurrent calls so parallel requests can never exceed p_max.
CREATE OR REPLACE FUNCTION consume_trial_item(
  p_user_id UUID,
  p_section TEXT,
  p_kind    TEXT,
  p_item_id TEXT,
  p_max     INTEGER
)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, already_consumed BOOLEAN)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_account_wide BOOLEAN := p_kind = 'sample_test';
  v_used INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_user_id::text || ':' || p_kind || ':' || CASE WHEN v_account_wide THEN '*' ELSE p_section END,
      0
    )
  );

  SELECT COUNT(*)::INTEGER INTO v_used
  FROM trial_usage t
  WHERE t.user_id = p_user_id
    AND t.kind = p_kind
    AND (v_account_wide OR t.section = p_section);

  IF EXISTS (
    SELECT 1 FROM trial_usage t
    WHERE t.user_id = p_user_id AND t.kind = p_kind AND t.item_id = p_item_id
  ) THEN
    RETURN QUERY SELECT TRUE, GREATEST(p_max - v_used, 0), TRUE;
    RETURN;
  END IF;

  IF v_used >= p_max THEN
    RETURN QUERY SELECT FALSE, 0, FALSE;
    RETURN;
  END IF;

  INSERT INTO trial_usage (user_id, section, kind, item_id)
  VALUES (p_user_id, p_section, p_kind, p_item_id);

  RETURN QUERY SELECT TRUE, p_max - v_used - 1, FALSE;
END;
$$;

-- Only the server (service role) may consume quota.
REVOKE ALL ON FUNCTION consume_trial_item(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION consume_trial_item(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
