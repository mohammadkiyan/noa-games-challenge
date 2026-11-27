<!-- cap: 500 words -->
# Roadmap
A **hypothetical** production plan for one backend engineer, not the take-home.

## Assumptions
- ~3.5 build days/week; AI helps tests and boilerplate, no fixed multiplier.
- **Mobile UI is another team's, capacity unknown:** the biggest schedule risk.
- Store build submitted end of W9 (review time unconfirmed).
- A9 (wallet idempotency), A10 (local JWT) unconfirmed.
- Fixed date, early in a league week, so the first payout is ≥ 7 days later.

## 12 weeks (outcome → exit criterion)
1. **Contracts:** A9, A10, match identity, reset time, coin cap → answered or fallback chosen; API draft shared.
2. **Join and report** on a real JWT → 50 concurrent joins never make 51; duplicates add nothing.
3. **Client levers** (polls, Retry-After, kill switch), rate limits → **API frozen**.
4. **Week close** → a rerun gives the same ledger and tiers; resumes after a kill; cross-reset reports count once, in the first report's week.
5. **Payouts** on the wallet sandbox → kill -9 mid-payout never double-pays; the cap blocks.
6. **End to end** on two phones → retry queue, backoff, jitter verified.
7. **Production:** servers, replica, outside dump, alerts, SHA deploy → deploy and rollback timed.
8. **Capacity** on the real box, 4.2M members / 84k leagues → CHANGE-RESPONSE gates, onboarding included, pass, else CCX53 or split decided.
9. **Store build submitted** → failover and restore drills timed in OPS.
10. **Rehearsal** → week close at 84k leagues, payout dry run; beta cohort invariants hold.
11. **Hardening:** rescale, rerun gates, pre-create leagues → deploy freeze.
12. **Launch** → on shift for the first hours.

## Critical path
- **Client (earliest hard date):** W1 contracts → W3 API frozen → W9 store build → W12. Slips never move the date: Leagues stays off.
- **Money:** W4 close → W5 payouts → W10 rehearsal.
- **Infra:** W7 production → W8 gates → W9 drills → W11 rescale.
- **External:** login team (A10), wallet team (A9, sandbox), Hetzner limits, store review.

One engineer, one path: slips cascade.

## If three weeks are lost (9 weeks)
Savings are planning estimates; if short, the gates below decide. Already out (global rank, friends, challenges, clubs, WebSockets) saves nothing.
- **Delay activation:** payout worker (ledger still written): reduced launch until **Coins on**.
- **Simplify:** admin endpoints → previewed SQL; deploy → script; dashboards → alerts only.
- **Cut:** pair-repeat flags (cap and approval remain); beta cohort.
- **Never cut:** idempotent reports and week close, boundaries, cap, safe payouts, replica, dump, a timed restore, page alerts, store-build levers, JWT checks, the 2,150 gate.

## Launch gates
- **Leagues on** (launch day): CHANGE-RESPONSE gates pass; store build live (426 for old apps); real login integrated; failover and restore timed; week close rehearsed; page alerts tested. Fail → game ships on date, Leagues off.
- **Coins on** (before the first payout): wallet sandbox integrated; A9 confirmed or manual reconciliation; kill test, cap agreed, approval tested. Fail → reduced launch: coins shown pending, no payout date promised, none moved.
