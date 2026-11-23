# E2E tests (Playwright) — staging only

`trial/` exercises the free-trial / Pro gating end to end; `suite/` covers the daily quest, accountability,
payments, notifications, accessibility and responsive layout. They **only run against athena-staging**:
`lib/env.ts` loads `../.env.staging` and refuses to start if Supabase or `DATABASE_URL` points anywhere else.
Never point them at prod.

## Run

```bash
# 1. App on :3100 against staging (from the repo root)
npm run dev:staging

# 2. Tests (from e2e/)
cd e2e
npm install            # first time; then: npx playwright install chromium
npx playwright test                                   # everything
npx playwright test trial/a1-trial-core.spec.ts       # one spec
npx playwright test --project=mobile                  # iPhone 13 (Chromium) only
```

- `E2E_BASE_URL` overrides the app URL (default `http://localhost:3100`).
- `E2E_TRIAL_MODE` (`full` default | `limited`) must match `TRIAL_MODE` in `src/lib/trial.ts`: `full` runs
  `a-full-trial.spec.ts`, `limited` runs the quota specs `a1`–`a3`.
- `c-upgrade` needs Stripe webhooks forwarded: `stripe listen --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.payment_failed --forward-to localhost:3100/api/stripe/webhook`.
- `E2E_SKIP_CHECKOUT=1` skips the Stripe checkout specs (`c-upgrade`). Set it once the Pro accounts
  have already been upgraded on staging, so repeated runs don't create new test subscriptions.

## Groups

| Group | Command (from `e2e/`) | Notes |
|---|---|---|
| Unit: adaptive engine, quest mix, scoring, notification rules | `npm test` (repo root) | `src/lib/adaptive/*.test.ts`, `src/lib/cpa-scoring.test.ts`, `src/lib/notifications/*.test.ts`; no server needed, ~1 min |
| Smoke (~5 min, after every deploy) | `npm run test:smoke` | `@smoke`-tagged tests (8), desktop only; accounts must exist. 5½ min against `next dev`, less on a build |
| Full | `npm run test:full` | accounts setup + every spec on desktop and mobile |
| suite/ only | `npm run test:suite` | |
| Daily quest | `npx playwright test suite/quest.spec.ts` | 20 questions, 60/30/10 mix, sequential UI, completion, XP, streak |
| Accountability | `npx playwright test suite/accountability.spec.ts` | missed quest → locked → recommit; schedule change forward only |
| Payments | `npx playwright test suite/billing.spec.ts --project=desktop` | Stripe **test clock**: subscribe, renewal, failed payment (+grace if `users.payment_failed_at` exists), cancel, coupon. Doesn't need `stripe listen`: specs post signed sync events themselves. See *Stripe test clocks* below |
| Notifications | `npx playwright test suite/notifications.spec.ts --project=desktop` | 15-min scheduler `/api/cron/notifications?dryRun=1&now=…`: quest available, +4h incomplete, final, missed, streak at risk, weekly summary, quiet hours, opt-out, expired. Plus legacy `streak-alerts?dryRun=1`. Needs `CRON_SECRET` |
| Accessibility | `npx playwright test suite/a11y.spec.ts` | axe WCAG 2.1 A/AA on dashboard, learning, quiz, TBS, progress, subscribe; fails on serious/critical. Known app bugs: `KNOWN` in the spec |
| Responsive | `npx playwright test suite/responsive.spec.ts --project=desktop` | same pages at 375/768/1440: no horizontal scroll, no covered buttons. Known app bugs: `KNOWN` in the spec |

Every `suite/` spec resets its own account with SQL (`resetLearner` in `lib/state.ts`), so specs run in any order.
Shared helpers: `lib/flows.ts` (`todaysQuest`, `answerOption`), `lib/state.ts` (`resetLearner`, `seedQuestStreak`,
`answerQuestInDb`), `lib/pages.ts` (key pages, axe, layout checks), `lib/stripe.ts` (test clocks, signed webhook sync).

### Known app bugs in the specs

Reported bugs are kept visible instead of failing the run, and turn red when fixed so the marker gets removed:
- `test.fail()` with a `KNOWN BUG` comment (quest, accountability): the test asserts the correct behaviour.
- `KNOWN` maps in `a11y.spec.ts` / `responsive.spec.ts`: listed page + rule/width is reported as an annotation;
  any other violation still fails.

### Stripe test clocks

On the staging Stripe account a test clock advances but never cycles a subscription (no renewal invoice).
`billing.spec.ts` still advances the clock first; if the period didn't roll it forces the renewal with a cycle
reset billed immediately (`billing_cycle_anchor=now`, `proration_behavior=always_invoice`), and for "period
ended" cancels immediately. Each fallback is noted as a test annotation.

### Machine notes

`next dev` on Windows can leave hundreds of orphaned `.next/dev/build/postcss.js` node workers behind after
restarts (seen: ~950 processes, ~32 GB). If pages start timing out while `/api/health` still answers, check the
node.exe count and kill those workers.

## Projects

| Project    | What it does                                                        |
|------------|---------------------------------------------------------------------|
| `accounts` | Setup: creates/onboards the test accounts and saves sessions        |
| `desktop`  | `trial/**` + `suite/**` specs at 1440×900                           |
| `mobile`   | same specs with the iPhone 13 descriptor on Chromium (Stripe, notifications and responsive run on desktop only) |
| `admin`    | `admin/**`, desktop                                                 |
| `beta`     | `beta/**`, desktop (creates and deletes one throwaway account)      |

Run `npx playwright test --project=accounts` once on a fresh staging DB before the other projects.

## Test accounts

Defined in `lib/accounts.ts`, one per role: `trial`, `trial-lastday`, `expired`, `pro`, `pro-annual`,
`trial-other`, and for `suite/`: `quest`, `ui`, `billing`, `notify`. Emails are `e2e+<role>+clerk_test@example.com`. The `+clerk_test` suffix makes Clerk's dev
instance accept the verification code `424242` and skip sending email. All accounts share one random
password, generated on first run and stored in the gitignored `.auth/` folder. Account state (tier,
trial end date, quota usage) is reset by direct SQL against staging (`lib/db.ts`).
