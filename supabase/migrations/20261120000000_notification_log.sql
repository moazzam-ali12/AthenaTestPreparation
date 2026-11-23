-- Timezone-aware notifications.
--
-- 1. notification_log: one row per (user, type, local_date). The scheduler and the
--    quest-complete event INSERT ... ON CONFLICT DO NOTHING before sending, so a
--    notification is sent at most once even if the cron runs twice or concurrently.
-- 2. users.notification_settings: per-type, per-channel opt-outs,
--    e.g. {"weekly_summary": {"email": false}}. Missing keys mean "on".
-- 3. pg_cron + pg_net call /api/cron/notifications every 15 minutes (Vercel Hobby
--    only allows daily crons). URL and secret come from Supabase Vault:
--      select vault.create_secret('https://<app>/api/cron/notifications', 'notifications_cron_url');
--      select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--    Until both secrets exist the job is a no-op.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  local_date DATE NOT NULL,
  channel    TEXT NOT NULL,          -- e.g. 'email,push'; 'none' = suppressed but recorded
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta       JSONB,
  CONSTRAINT notification_log_once UNIQUE (user_id, type, local_date)
);

-- Server-only table (service role bypasses RLS); no client policies.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notification_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.invoke_notifications_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'notifications_cron_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_notifications_cron() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.invoke_notifications_cron() FROM anon, authenticated;
  END IF;
END $$;

-- Schedule only where pg_cron and pg_net are available (Supabase); plain Postgres skips it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    CREATE EXTENSION IF NOT EXISTS pg_net;
    -- cron.schedule upserts by job name, so re-running is safe.
    PERFORM cron.schedule(
      'notifications-every-15-min',
      '*/15 * * * *',
      'SELECT public.invoke_notifications_cron()'
    );
  END IF;
END $$;
