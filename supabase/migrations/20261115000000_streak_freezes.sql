-- Streak freeze periods: calendar days a user was locked out of the app
-- (trial ended / subscription lapsed) before (re)subscribing. The daily and
-- weekly streak calculations skip these days, so a 7-day streak continues at 8
-- on the first active day after subscribing — however late they subscribe.
--
-- Written only by the server (Stripe webhook, service role) when a locked user
-- gains Pro access. Both dates are inclusive local calendar days.

CREATE TABLE IF NOT EXISTS streak_freezes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT streak_freezes_range CHECK (end_date >= start_date),
  -- Idempotent under Stripe webhook retries / several events per checkout.
  CONSTRAINT streak_freezes_user_start_key UNIQUE (user_id, start_date)
);

CREATE INDEX IF NOT EXISTS streak_freezes_user_idx ON streak_freezes (user_id);

-- Same RLS as the trial tables: users read their own rows; writes are server-only.
ALTER TABLE streak_freezes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'streak_freezes' AND policyname = 'Users can read own streak freezes'
  ) THEN
    CREATE POLICY "Users can read own streak freezes" ON streak_freezes
      FOR SELECT
      USING (user_id IN (SELECT id FROM users WHERE clerk_id = (auth.jwt() ->> 'sub')));
  END IF;
END $$;
