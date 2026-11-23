-- Stored daily streak: O(1) streak reads instead of rebuilding it from quest history.
--
-- users.current_streak / users.best_streak already exist (20260720000000, 20260304000000).
-- current_streak now means "the streak as of streak_last_date"; readers turn it into
-- the live number with getEffectiveStreak (src/lib/streak.ts), which returns 0 once
-- a non-frozen day has been missed since streak_last_date.
--
-- The continuation rule MUST match computeDailyStreak in src/lib/streak.ts: a new
-- day continues the streak when every calendar day strictly between
-- streak_last_date and it is covered by a streak_freezes row (inclusive ranges).

ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_last_date DATE;

-- Counts p_day for the user's streak. Atomic: the row lock (FOR UPDATE) serialises
-- concurrent completions, so two calls for the same day can't double-count.
--   p_day = streak_last_date (or earlier) -> unchanged (idempotent)
--   next counted day (only frozen days in between) -> +1
--   otherwise -> 1
CREATE OR REPLACE FUNCTION record_streak_day(p_user_id UUID, p_day DATE)
RETURNS TABLE (current_streak INTEGER, best_streak INTEGER, streak_last_date DATE)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_last    DATE;
  v_streak  INTEGER;
  v_new     INTEGER;
BEGIN
  SELECT u.streak_last_date, u.current_streak INTO v_last, v_streak
  FROM users u WHERE u.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_last IS NOT NULL AND p_day <= v_last THEN
    -- Same day again (or an older quest completed late): no change.
    v_new := v_streak;
  ELSIF v_last IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM generate_series(v_last + 1, p_day - 1, INTERVAL '1 day') AS g(d)
    WHERE NOT EXISTS (
      SELECT 1 FROM streak_freezes f
      WHERE f.user_id = p_user_id AND g.d::date BETWEEN f.start_date AND f.end_date
    )
  ) THEN
    v_new := COALESCE(v_streak, 0) + 1;
  ELSE
    v_new := 1;
  END IF;

  RETURN QUERY
  UPDATE users u
  SET current_streak   = v_new,
      best_streak      = GREATEST(COALESCE(u.best_streak, 0), v_new),
      streak_last_date = GREATEST(COALESCE(u.streak_last_date, p_day), p_day)
  WHERE u.id = p_user_id
  RETURNING u.current_streak, u.best_streak, u.streak_last_date;
END;
$$;

-- Backfill / reconcile (scripts/streak-reconcile.ts): sets many users' stored streak in
-- one statement. rows = [{ "id": uuid, "current_streak": int, "streak_last_date": "YYYY-MM-DD"|null }]
CREATE OR REPLACE FUNCTION apply_streak_backfill(p_rows JSONB)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
  WITH r AS (
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(id UUID, current_streak INTEGER, streak_last_date DATE)
  ), upd AS (
    UPDATE users u
    SET current_streak   = r.current_streak,
        best_streak      = GREATEST(COALESCE(u.best_streak, 0), r.current_streak),
        streak_last_date = r.streak_last_date
    FROM r WHERE u.id = r.id
    RETURNING 1
  )
  SELECT COUNT(*)::int FROM upd;
$$;

-- Server-only (service role). Supabase grants EXECUTE to anon/authenticated by default.
REVOKE ALL ON FUNCTION record_streak_day(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_streak_backfill(JSONB) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION record_streak_day(UUID, DATE) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION apply_streak_backfill(JSONB) FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION record_streak_day(UUID, DATE) TO service_role;
    GRANT EXECUTE ON FUNCTION apply_streak_backfill(JSONB) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
