-- Tests for consume_trial_daily / refund_trial_daily (20261114000000_trial_tutor_cap.sql).
-- Runs inside a transaction and rolls back:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/consume_trial_daily.test.sql
-- Concurrency (two sessions racing for the last message) is covered separately
-- by running consume_trial_daily from parallel psql sessions; see the PR notes.
BEGIN;

DO $$
DECLARE
  u UUID;
  r RECORD;
  i INTEGER;
  n INTEGER;
  today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
BEGIN
  INSERT INTO users (clerk_id, email) VALUES ('test_daily_' || gen_random_uuid(), 'daily@test.local')
  RETURNING id INTO u;

  -- 20 messages allowed; remaining counts down to 0.
  FOR i IN 1..20 LOOP
    SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 20);
    ASSERT r.allowed, format('message %s should be allowed', i);
    ASSERT r.remaining = 20 - i, format('remaining after %s should be %s, got %s', i, 20 - i, r.remaining);
    ASSERT r.usage_day = today, 'usage_day is the UTC day';
  END LOOP;

  -- The 21st is blocked and does not move the counter.
  SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 20);
  ASSERT NOT r.allowed AND r.remaining = 0, '21st message must be blocked';
  SELECT used INTO n FROM trial_daily_usage WHERE user_id = u AND kind = 'tutor_msg' AND usage_date = today;
  ASSERT n = 20, format('counter must stay at the cap, got %s', n);

  -- A refund (failed LLM call) frees exactly one message.
  PERFORM refund_trial_daily(u, 'tutor_msg', today);
  SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 20);
  ASSERT r.allowed AND r.remaining = 0, 'refunded message can be reused';
  SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 20);
  ASSERT NOT r.allowed, 'still capped after reusing the refund';

  -- Refund never goes below zero.
  INSERT INTO trial_daily_usage (user_id, kind, usage_date, used) VALUES (u, 'tutor_msg', today - 3, 0);
  PERFORM refund_trial_daily(u, 'tutor_msg', today - 3);
  SELECT used INTO n FROM trial_daily_usage WHERE user_id = u AND usage_date = today - 3;
  ASSERT n = 0, 'refund must not go negative';

  -- A new day starts fresh: simulate by moving today's row to yesterday.
  UPDATE trial_daily_usage SET usage_date = today - 1 WHERE user_id = u AND usage_date = today;
  SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 20);
  ASSERT r.allowed AND r.remaining = 19, 'cap resets on the next UTC day';

  -- p_max <= 0 never allows anything.
  SELECT * INTO r FROM consume_trial_daily(u, 'tutor_msg', 0);
  ASSERT NOT r.allowed, 'zero cap blocks';

  -- Unknown kinds are rejected by the check constraint.
  BEGIN
    PERFORM consume_trial_daily(u, 'bogus', 20);
    RAISE EXCEPTION 'unknown kind should fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'consume_trial_daily: all assertions passed';
END $$;

ROLLBACK;
