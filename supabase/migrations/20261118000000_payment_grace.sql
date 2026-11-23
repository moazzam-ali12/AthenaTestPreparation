-- Failed-payment grace period + billing plan tracking.
--   payment_failed_at          first failed payment of the current past_due spell; cleared when
--                              payment succeeds. past_due keeps Pro for GRACE_PERIOD_DAYS from it
--                              (src/lib/plans.ts, enforced in getAccess).
--   payment_reminder_sent_at   the "grace ends in 2 days" email went out for this spell (dedupe).
--   billing_plan               'monthly' | 'annual' — the CPA plan of the user's best subscription.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_plan TEXT;

CREATE INDEX IF NOT EXISTS users_payment_failed_at_idx
  ON users(payment_failed_at) WHERE payment_failed_at IS NOT NULL;
