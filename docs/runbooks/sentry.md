# Runbook: Sentry (errors, source maps, uptime, cron)

## Setup

1. Sentry → Create project **Next.js** (e.g. `athena-web`) and project **Python/FastAPI** (`athena-agents`).
2. Settings → Auth Tokens → Organization token (scope `project:releases`, `org:read`) for source maps.
3. Set env vars (names in `.env.example`):

| Where | Variables |
|---|---|
| Vercel (Preview = staging, Production = production) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (web DSN), `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Agents host | `SENTRY_DSN` (agents DSN), `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (git SHA, if the host has no `.git`) |
| Optional anywhere | `SENTRY_SAMPLE_RATE` (default 1.0), `SENTRY_TRACES_SAMPLE_RATE` (default 0.1) |

Without a DSN, Sentry is disabled (local dev). Release = git SHA (`VERCEL_GIT_COMMIT_SHA`).
Source maps are uploaded and then deleted from the build output only when `SENTRY_AUTH_TOKEN` is set.

## Verify (staging)

Signed in on a non-production deploy, open `/debug/sentry` and press each button: browser, API route,
agents backend. Production returns 404. Then in Sentry, for each event, check:
- environment = `staging`, release = the deployed SHA, user = internal id only (no email/IP);
- no `Authorization`/cookie headers, no request body, no answers or emails;
- stack frames show real file names (e.g. `src/app/api/debug/sentry/route.ts`), not chunk files.

## Uptime monitor (app)

1. Sentry → Alerts → Create alert → **Uptime monitor**.
2. URL `https://<app-domain>/api/health` (checks the app and the DB), method GET, interval 5 min,
   environment `production`, project `athena-web`.
3. Assign a team or owner. Add the email or Slack action. Repeat for staging if wanted.

## Cron monitor (notifications)

`/api/cron/notifications` wraps every real tick in `Sentry.withMonitor("notifications-cron")`
(schedule `*/15 * * * *` UTC, 5-min margin, 2-min max runtime). The monitor **creates itself** on the first
check-in once the DSN is set, with no dashboard step. After the first run:
1. Sentry → Crons → `notifications-cron` → confirm check-ins are arriving.
2. Edit → Alerting: notify after 2 consecutive missed or failed check-ins, and set the owner.
3. A tick only runs once the Vault secrets `notifications_cron_url` + `cron_secret` exist (see
   `docs/runbooks/restore.md` step 5). Until then the monitor reports "missed", which is expected.
