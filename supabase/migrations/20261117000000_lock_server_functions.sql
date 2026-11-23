-- Lock server-only database functions.
--
-- Supabase grants EXECUTE on every new function in `public` to anon and
-- authenticated (via default privileges), so `REVOKE ... FROM PUBLIC` alone
-- leaves them callable with the browser (anon) key. All of these functions
-- take a user id and are only ever called by the Next.js server / scripts
-- with the service role, so revoke them from every client role.

REVOKE EXECUTE ON FUNCTION consume_trial_item(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION consume_trial_daily(UUID, TEXT, INTEGER)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION refund_trial_daily(UUID, TEXT, DATE)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_streak_day(UUID, DATE)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION apply_streak_backfill(JSONB)                        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION consume_trial_item(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION consume_trial_daily(UUID, TEXT, INTEGER)            TO service_role;
GRANT EXECUTE ON FUNCTION refund_trial_daily(UUID, TEXT, DATE)                TO service_role;
GRANT EXECUTE ON FUNCTION record_streak_day(UUID, DATE)                       TO service_role;
GRANT EXECUTE ON FUNCTION apply_streak_backfill(JSONB)                        TO service_role;

-- Legacy RPCs from 20260312_rpc_functions.sql (take p_user_id, no callers).
-- They may be absent on some databases, so lock them only if present.
DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.save_sat_quiz_session(uuid,uuid,int,int,int,jsonb)',
    'public.save_custom_topic(uuid,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.save_custom_quiz_session(uuid,uuid,int,int,int,jsonb)'
  ] LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END IF;
  END LOOP;
END $$;

-- New functions created by this role (the migration role) are locked by
-- default; grant to anon/authenticated explicitly when a function is meant to
-- be called from the browser. The global PUBLIC default must be revoked
-- separately: per-schema defaults can only add to it, not remove from it.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
