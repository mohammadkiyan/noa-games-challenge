<!-- cap: 500 words -->
# Roadmap
A **hypothetical** production plan for one backend engineer, not the take-home.

## Assumptions
- ~3.5 build days/week; AI helps tests and boilerplate, no fixed multiplier.
- **Mobile UI is another team's, capacity unknown:** the biggest schedule risk.
- Store build submitted end of W9 (review time to confirm).
- A9 (wallet idempotency), A10 (local JWT) unconfirmed.
- Launch early in a league week, so the first payout is ≥ 7 days later.

## 12 weeks (outcome → exit criterion)
1. **Contracts:** A9, A10, match identity, reset time, coin cap → answered or fallback chosen; API draft shared.
2. **Join and report** on a real JWT → 50 concurrent joins never make 51; duplicates add nothing.
3. **Client levers** (polls, Retry-After, kill switch), rate limits → **API frozen**.
4. **Week close** → a rerun gives the same ledger and tiers; resumes after a kill; boundary tests pass.
5. **Payouts** on the wallet sandbox → kill -9 mid-payout never double-pays; the cap blocks.
6. **End to end** on two phones → retry queue with backoff and jitter verified.
7. **Production:** servers, replica, outside dump, alerts, SHA deploy → deploy and rollback timed.
8. **Capacity** on the real box with 600k-member data → CHANGE-RESPONSE gates pass, else CCX53 or split decided.
9. **Store build submitted** → failover and restore drills timed in OPS.
10. **Rehearsal** → week close and payout at launch size; beta cohort invariants hold.
11. **Hardening:** rescale, rerun gates, pre-create leagues → deploy freeze.
12. **Launch** → on shift for the first hours.

## Critical path
- **Client (earliest hard date):** W1 contracts → W3 API frozen → W9 store build → W12. Mobile or review slips move launch.
- **Money:** W4 week close → W5 payouts → W10 rehearsal.
- **Infra:** W7 production → W8 gates → W9 drills → W11 rescale.
- **External:** login team (A10), wallet team (A9, sandbox), Hetzner limits, store review.

One engineer, one path at a time: slips cascade.

## If three weeks are lost (9 weeks)
- **Move after launch:** the payout worker. Week close still writes the ledger; no coin moves until the worker passes its kill test and A9 is confirmed or a person reconciles. Cost: late week-1 coins.
- **Simplify:** admin endpoints → previewed SQL; deploy → script; dashboards → alerts only; disputed matches just don't count.
- **Cut:** pair-repeat flags (cap and approval remain); beta cohort.
- **Not savings:** global rank, friends, challenges, clubs, WebSockets (already out).
- **Never cut:** idempotent atomic reports and week close, week boundaries, the cap, safe payouts, replica, dump, one timed restore, page alerts, store-build levers, JWT verification, the 2,150 gate.
- Savings (~3 weeks) are estimated; if short, the game ships on date and Leagues stays off until the gates pass.

## Launch gate
All required: CHANGE-RESPONSE gates pass on the real box; store build live, old apps get 426; real login and wallet sandbox integrated; failover and restore timed; week close and payout rehearsed at launch size; page alerts tested.
