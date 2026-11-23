# Athena CPA — Beta Playbook (first 10–50 students)

Goal: learn fast, fix fast. Small cohort, tight feedback loop, daily triage.

## 1. Setup checklist

1. Apply `supabase/migrations/20261119100000_beta_launch.sql` (staging first, then prod).
2. Create invite codes in **/admin/beta** (one shared code per wave, e.g. `BETA-WAVE1`, `max_uses` = wave size, `expires_at` = +14 days). Use single-use codes for individuals you want to track.
3. Invite link format: `https://<app-domain>/sign-up?invite=<CODE>`.
4. **Optional Stripe discount (dashboard only, no code changes):**
   1. Stripe Dashboard → Product catalog → **Coupons** → *Create coupon* (e.g. 50% off, duration *repeating* 3 months, name "Athena Beta").
   2. On the coupon → **Promotion codes** → *Create* code `BETA50`; set "Limit to first-time customers", an expiry date and a max-redemptions cap ≈ cohort size.
   3. Confirm Checkout has *Allow promotion codes* enabled (`allow_promotion_codes: true` on the Checkout Session). If it isn't, testers can't enter the code — enable it before announcing.
   4. Do it in **test mode** first and run one checkout on staging.
5. Smoke test on prod with a throwaway account: invite signup → onboarding → diagnostic → one quest → feedback → check it appears in /admin/beta.

## 2. Invite email

> **Subject:** You're in — Athena CPA beta
>
> Hi {first name},
>
> Thanks for helping us build Athena, an AI study coach for the CPA exam. You're one of a small group getting early access.
>
> **Get started (10 min):** {invite link}
> 1. Sign up and take the short diagnostic.
> 2. Do your first daily quest.
> 3. Come back on day 3 and do another one.
>
> **What we'd love from you:** use it like you'd really study. When something breaks, confuses you, or sparks an idea, hit the **Feedback** button (bottom corner) — it takes 20 seconds and sends us the page you were on.
>
> Beta perk: use code **{PROMO}** at checkout for {discount}.
>
> We read every message. Reply here anytime.
>
> — {sender}, Athena team

## 3. What to ask testers

Week 1 (async, via the Feedback button or email):
- Was anything confusing in the first 10 minutes? Where did you hesitate?
- Did the diagnostic result feel accurate for your weak areas?
- Was the tutor's explanation right *and* useful? Flag any wrong accounting content — this is the top-priority signal.
- Would you study here instead of / alongside your current review course? Why or why not?

Day 7–10 (15-min call with 5–8 testers):
- Walk me through your last session. What did you do next after it?
- What almost made you stop using it?
- What would make this worth paying for? What price feels fair?
- 0–10: how disappointed would you be if Athena disappeared?

## 4. Daily triage routine (~20 min, every weekday)

1. **/admin/beta → Feedback**: read every `new` item. Set to `triaged` once it has an owner/ticket; `fixed` when deployed. Open the Sentry event when one is linked.
2. **Sentry**: new issues in the last 24h, sorted by users affected.
3. **Funnel** (/admin/beta, *beta* cohort): note the counts for signup → onboarding → first quest → day-3 return → subscribe. Drops >30% between steps get a look.
4. Assign severity (below), fix S1 same day, reply to the reporter when their issue ships.
5. Post a 3-line summary in the team channel: new feedback count, top issue, funnel change.

## 5. Bug severity

| Sev | Definition | Response |
|---|---|---|
| **S1** | Can't sign up/log in, data loss, payment charged incorrectly, **incorrect accounting content presented as correct**, security/privacy issue | Fix or roll back same day; notify affected testers |
| **S2** | Core flow broken for some users (quest, tutor, diagnostic, exam), wrong scoring/streak, crash with workaround | Fix within 48h |
| **S3** | Confusing UX, layout issues, slow but working, minor content quality | Batch weekly |
| **S4** | Ideas, polish, nice-to-haves | Backlog; review weekly for patterns |

## 6. Go / no-go for wider launch

Go only when **all** hold for the last 7 days of the beta cohort:
- **Stability:** zero open S1; ≤ 2 open S2; Sentry crash-free sessions ≥ 99%.
- **Content:** no confirmed wrong-answer/explanation reports left unfixed; spot-check of 50 random tutor answers ≥ 95% correct.
- **Activation:** ≥ 70% of signups finish onboarding; ≥ 50% start a first quest.
- **Retention:** ≥ 35% of signups return on day 3+.
- **Payments:** ≥ 1 successful real-card subscription and cancellation end-to-end; webhook errors = 0.
- **Signal:** ≥ 40% of interviewed testers "very disappointed" if Athena disappeared (or a clear plan for the gap).

If any fail: extend the beta one more week, fix, re-measure. Don't widen invites to hide a retention problem.
