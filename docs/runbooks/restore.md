# Runbook: restore the database from a backup

Use this when the production Supabase project is lost or corrupted (the free plan has no
point-in-time recovery). You restore into a **new** project and point the apps at it, and you
never restore over the broken project.

## What a backup contains

- Made nightly by `.github/workflows/backup-db.yml` → `scripts/backup-db.sh` (`pg_dump -F c`).
- Schemas: `public` (all app tables, functions, triggers, RLS policies) and `supabase_migrations`
  (migration history).
- Stored in the private bucket `db-backups` of the project given by `BACKUP_STORAGE_URL`:
  `daily/<label>-YYYY-MM-DD.dump` (last 14) and `weekly/…` (last 8, Sundays).
- **Not included:** `auth` (unused, since Clerk handles auth), `storage` objects (the `feedback` bucket),
  Vault secrets and the pg_cron job. Step 5 recreates the last two.

## 1. Create the new project

1. Supabase dashboard → New project. Use the same region and Postgres major version (17) as before.
   Save the DB password in the password manager.
2. Project Settings → Database → Connection string → **Session pooler** (port 5432). Call it `$NEW_DB`.
   Don't use the transaction pooler (:6543) for pg_dump or pg_restore.
3. You need `pg_restore`/`psql` **17 or newer** (`pg_restore --version`).

## 2. Download the backup

Dashboard of the backup project → Storage → `db-backups` → `daily/` → download the newest
`prod-YYYY-MM-DD.dump`. Or use the API:

```bash
curl -fsS -H "apikey: $BACKUP_STORAGE_KEY" -o restore.dump \
  "$BACKUP_STORAGE_URL/storage/v1/object/authenticated/db-backups/daily/prod-YYYY-MM-DD.dump"
pg_restore --list restore.dump > /dev/null && echo "archive OK"
```

(Older JWT service-role keys also need `-H "Authorization: Bearer $BACKUP_STORAGE_KEY"`.)

## 3. Restore

```bash
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$NEW_DB" restore.dump
```

- `--no-privileges` is fine: Supabase's default privileges re-grant `anon`/`authenticated`/
  `service_role` on objects that `postgres` creates.
- Expected noise: at most `schema "public" already exists`. Anything else needs a look before you continue.
- Functions that call `net.http_get` or `vault.*` restore fine, because bodies aren't checked at restore time.

## 4. Verify row counts

Compare the restored DB with the counts at backup time. If the old project is still readable,
count it now. Otherwise compare against the last known counts (or a second restore of the same dump).

```bash
psql "$NEW_DB" -At -F ',' -f scripts/db-row-counts.sql > restored.csv
psql "$OLD_DB" -At -F ',' -f scripts/db-row-counts.sql > source.csv   # if reachable
diff source.csv restored.csv && echo "ROW COUNTS MATCH"
psql "$NEW_DB" -Atc "select count(*) from supabase_migrations.schema_migrations"
```

The old DB keeps taking writes, so counts taken later than the dump can be higher. A difference
only counts as a failure when the old DB was quiet. Then smoke-test: sign in, open the dashboard,
answer one question.

## 5. Recreate what is not in the dump

```sql
-- Notifications cron (see supabase/migrations/20261120000000_notification_log.sql)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('https://<app-domain>/api/cron/notifications', 'notifications_cron_url');
select vault.create_secret('<CRON_SECRET from Vercel>', 'cron_secret');
select cron.schedule('notifications-every-15-min', '*/15 * * * *', 'select public.invoke_notifications_cron()');
```

Also recreate the Storage bucket `feedback` (dashboard → Storage), with the same settings as the old project.

## 6. Switch environment variables

| Where | Variables |
|---|---|
| Vercel (Production) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| Agents backend host | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| GitHub → Actions secrets | `BACKUP_DATABASE_URL` (and `BACKUP_STORAGE_*` if the bucket moved) |
| Local | `.env`, `agents/.env`, `supabase link --project-ref <new-ref>` |

Redeploy Vercel (env changes need a new deployment) and restart the agents backend. Check
`/api/health`, then watch Sentry for new errors for 30 minutes. Clerk and Stripe webhooks point at the app
URL, so they need no change.

## Test record

| Date | Source | Target | Result |
|---|---|---|---|
| 2026-11-17 | staging (`kumtumkzkcwvkwbgskjo`), `public` | throwaway local Postgres 18 cluster (`initdb`, stub `auth.jwt()` + Supabase roles) | Dump 10.8 MB, uploaded to `db-backups` and downloaded again (bash + PowerShell scripts). `pg_restore` 0 errors. **44/44 tables, 17,435 = 17,435 rows: match.** Staging counts were identical before and after the dump. |

An earlier attempt the same day showed ±1–4 row differences in 6 tables because staging was
being written to during the run (counts moved both up and down). That's why step 4 counts the source
around the dump time.
