-- Tests for consume_trial_item (20261111000000_free_trial.sql).
-- Runs inside a transaction and rolls back, so it is safe on any database
-- where the migration is applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/consume_trial_item.test.sql
-- Any failed assertion raises an exception and aborts the script.
BEGIN;

DO $$
DECLARE
  u UUID;
  r RECORD;
  i INTEGER;
  n INTEGER;
  progress_before INTEGER;
BEGIN
  INSERT INTO users (clerk_id, email) VALUES ('test_trial_' || gen_random_uuid(), 'trial@test.local')
  RETURNING id INTO u;

  -- New signup gets the 7-day window from column defaults.
  SELECT COUNT(*) INTO n FROM users
  WHERE id = u
    AND trial_started_at IS NOT NULL
    AND trial_ends_at BETWEEN NOW() + INTERVAL '7 days' - INTERVAL '1 minute'
                          AND NOW() + INTERVAL '7 days' + INTERVAL '1 minute';
  ASSERT n = 1, 'signup should default trial_ends_at to now() + 7 days';

  -- 10 distinct MCQs in AUD are allowed; remaining counts down to 0.
  FOR i IN 1..10 LOOP
    SELECT * INTO r FROM consume_trial_item(u, 'aud', 'mcq', 'q' || i, 10);
    ASSERT r.allowed AND NOT r.already_consumed, format('mcq %s should be allowed', i);
    ASSERT r.remaining = 10 - i, format('remaining after %s should be %s, got %s', i, 10 - i, r.remaining);
  END LOOP;

  -- The 11th new MCQ in AUD is blocked.
  SELECT * INTO r FROM consume_trial_item(u, 'aud', 'mcq', 'q11', 10);
  ASSERT NOT r.allowed AND r.remaining = 0, '11th mcq in a section must be blocked';

  -- Re-opening an already-seen MCQ is free and allowed.
  SELECT * INTO r FROM consume_trial_item(u, 'aud', 'mcq', 'q3', 10);
  ASSERT r.allowed AND r.already_consumed, 're-opening a seen mcq must be allowed';
  SELECT COUNT(*) INTO n FROM trial_usage WHERE user_id = u AND kind = 'mcq';
  ASSERT n = 10, 'retries must not add rows';

  -- Quotas are per section: FAR is untouched.
  SELECT * INTO r FROM consume_trial_item(u, 'far', 'mcq', 'f1', 10);
  ASSERT r.allowed AND r.remaining = 9, 'mcq quota is per section';

  -- TBS: 1 per section.
  SELECT * INTO r FROM consume_trial_item(u, 'aud', 'tbs', 't1', 1);
  ASSERT r.allowed, '1st tbs in AUD allowed';
  SELECT * INTO r FROM consume_trial_item(u, 'aud', 'tbs', 't2', 1);
  ASSERT NOT r.allowed, '2nd tbs in AUD blocked';
  SELECT * INTO r FROM consume_trial_item(u, 'reg', 'tbs', 't3', 1);
  ASSERT r.allowed, 'tbs quota is per section';

  -- Sample test: 1 per ACCOUNT, even in a different section.
  SELECT * INTO r FROM consume_trial_item(u, 'aud', 'sample_test', 's1', 1);
  ASSERT r.allowed, '1st sample test allowed';
  SELECT * INTO r FROM consume_trial_item(u, 'far', 'sample_test', 's2', 1);
  ASSERT NOT r.allowed, '2nd sample test blocked account-wide';

  -- Expiring the trial never touches data.
  SELECT COUNT(*) INTO progress_before FROM trial_usage WHERE user_id = u;
  UPDATE users SET trial_ends_at = NOW() - INTERVAL '1 day' WHERE id = u;
  SELECT COUNT(*) INTO n FROM trial_usage WHERE user_id = u;
  ASSERT n = progress_before, 'expiring a trial must not delete usage rows';

  RAISE NOTICE 'consume_trial_item: all assertions passed';
END $$;

ROLLBACK;
