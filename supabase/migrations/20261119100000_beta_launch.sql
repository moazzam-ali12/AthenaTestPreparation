-- Beta launch: invite codes, in-app feedback, product analytics events, user cohort.
--
-- Access model (same as 20261027000000_enable_rls.sql): the Next.js server talks to
-- Postgres with the service role, which bypasses RLS. RLS is enabled with NO
-- policies, so the browser (anon/authenticated) key can read or write nothing.
-- "Users insert their own feedback / admins read all" is enforced in the API
-- routes: /api/feedback stamps user_id from the Clerk session, and every
-- /api/admin/* route requires users.is_admin (20261118000000_admin_panel.sql).

-- ── Users: cohort ─────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS cohort TEXT;
CREATE INDEX IF NOT EXISTS users_cohort_idx ON users (cohort) WHERE cohort IS NOT NULL;

-- ── Beta invites ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_invites (
  code        TEXT PRIMARY KEY CHECK (code = upper(code) AND length(code) BETWEEN 4 AND 64),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used        INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  expires_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;

-- Atomically consume one use of a code and tag the user. Returns the outcome:
-- 'ok' | 'invalid' | 'expired' | 'used_up' | 'already_beta'.
CREATE OR REPLACE FUNCTION redeem_beta_invite(p_code TEXT, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code   TEXT := upper(trim(p_code));
  v_invite beta_invites%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND cohort = 'beta') THEN
    RETURN 'already_beta';
  END IF;

  SELECT * INTO v_invite FROM beta_invites WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= NOW() THEN RETURN 'expired'; END IF;
  IF v_invite.used >= v_invite.max_uses THEN RETURN 'used_up'; END IF;

  UPDATE beta_invites SET used = used + 1 WHERE code = v_code;
  UPDATE users SET cohort = 'beta', updated_at = NOW() WHERE id = p_user_id;
  RETURN 'ok';
END $$;

-- ── Feedback ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('bug', 'confusing', 'idea')),
  message          TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  screenshot_path  TEXT,           -- object path in the private 'feedback' storage bucket
  page_url         TEXT,
  user_agent       TEXT,
  app_version      TEXT,
  sentry_event_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'fixed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feedback_status_created_idx ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback (user_id);
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Private bucket for optional screenshots (served to admins via signed URLs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback', 'feedback', FALSE, 3145728, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- ── Product analytics events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (name IN (
                'signup', 'onboarding_done', 'diagnostic_done', 'quest_started',
                'quest_completed', 'tutor_used', 'paywall_viewed', 'checkout_started',
                'subscribed', 'churned')),
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_name_user_idx ON events (name, user_id);
CREATE INDEX IF NOT EXISTS events_user_created_idx ON events (user_id, created_at);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Strict funnel: each step counts distinct users who also reached every earlier step.
--   signup → onboarding_done → first quest_started → day-3 return → subscribed
-- "Day-3 return" = any event at least 3 days after the user's signup event.
-- p_cohort NULL = everyone; 'beta' = users.cohort = 'beta'.
CREATE OR REPLACE FUNCTION beta_funnel(p_cohort TEXT DEFAULT NULL)
RETURNS TABLE (step TEXT, users BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH signups AS (
    SELECT e.user_id, MIN(e.created_at) AS signed_up_at
    FROM events e
    JOIN users u ON u.id = e.user_id
    WHERE e.name = 'signup' AND (p_cohort IS NULL OR u.cohort = p_cohort)
    GROUP BY e.user_id
  ),
  onboarded AS (
    SELECT s.* FROM signups s
    WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.name = 'onboarding_done')
  ),
  quested AS (
    SELECT o.* FROM onboarded o
    WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = o.user_id AND e.name = 'quest_started')
  ),
  returned AS (
    SELECT q.* FROM quested q
    WHERE EXISTS (SELECT 1 FROM events e
                  WHERE e.user_id = q.user_id AND e.created_at >= q.signed_up_at + INTERVAL '3 days')
  ),
  subscribed AS (
    SELECT r.* FROM returned r
    WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = r.user_id AND e.name = 'subscribed')
  )
  SELECT * FROM (VALUES
    ('signup',          (SELECT COUNT(*) FROM signups)),
    ('onboarding_done', (SELECT COUNT(*) FROM onboarded)),
    ('first_quest',     (SELECT COUNT(*) FROM quested)),
    ('day3_return',     (SELECT COUNT(*) FROM returned)),
    ('subscribed',      (SELECT COUNT(*) FROM subscribed))
  ) AS t(step, users);
$$;

-- Server-only functions (see 20261117000000_lock_server_functions.sql).
REVOKE EXECUTE ON FUNCTION redeem_beta_invite(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION beta_funnel(TEXT)              FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION redeem_beta_invite(TEXT, UUID) TO service_role;
GRANT  EXECUTE ON FUNCTION beta_funnel(TEXT)              TO service_role;

NOTIFY pgrst, 'reload schema';
