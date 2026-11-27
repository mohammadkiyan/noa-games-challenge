<!-- cap: 500 words -->
# Change response
`[CHG-0x]` marks changed lines in PRD, DESIGN, CAPACITY.

## What changes
- **[CHG-01] Assumption.** "10× daily players" = 600k DAU every launch-week day, all in Leagues (pessimistic). Replaces, never stacks on, the 5× push multiplier.
- **[CHG-02] Load.** 600k × 43 = 25.8M requests/day. First-hour share (assumed) → rps (knee needed at 70%): 15% → 1,075 (1,540); **30% → 2,150 (3,070): plan**; 75% → 5,375 (7,680): stress test only. Reads spread over ~12k leagues, so I plan on the **cache-off knee, 800 rps** per laptop CPU (`08-knee.txt`), not 1,200. Old plan (CPX22, est. ≤ 2,250) fails.
- **[CHG-03] Servers.** **CCX43** (16 dedicated vCPU; est. need 4–7 plan, 9–18 stress): Caddy → ~8 Node processes → Postgres. Same-size async replica elsewhere; daily dump outside Hetzner. Built as CCX23 (160 GB disk), rescaled CPU/RAM-only, so it shrinks back. ≈ €280 for two weeks (one early): money is not the limit. After: both CCX23, ≈ €195/month. If gates fail: CCX53, then Postgres on its own box.
- **[CHG-04] Degradation ladder**, server-set, read by the launch app: (1) polls 3 → 1 per match (−37% requests); (2) polls off, `429 Retry-After` on reads (−56%); (3) Leagues off, game playable. Step up at p95 > 300 ms for 2 min or CPU > 70% for 5 min. Reports go last: phones resend; writes are idempotent.

## What does not change
Core loop, dual report, idempotent atomic writes, Postgres only, polling, coins only on promotion, paid after week close with approval.

## New cuts and sequencing
- **[CHG-05] Clubs: not in MVP.** Needs new club identity, membership, group scoring, reward split, mobile UI, abuse rules: est. 20+ days, untested on a fixed date. Lost: the banner's social promise. Say "play with friends" only if friends can already play each other. Next: "invite a friend into my league", after two stable weeks.
- **Moved before launch:** levers and retry backoff/jitter in the store build (earliest deadline); replica, outside dump, timed restore; pre-created leagues; week close and payout built and rehearsed.
- **Dropped:** one-report auto rule; anomaly alert (absolute cap instead).
- **Gates** (real box): 2,150 rps × 30 min at p95 < 300 ms, p99 < 800, errors < 0.1%, CPU ≤ 70%; 5,375 rps from cold cache, reports in SLO; points = results after each run. Failed gate: same date, launch at the ladder step that passed.

## New risks (→ mitigation; left over)
- Launch build lacks levers → ship them first; else only 429s.
- Real capacity unknown (laptop, one run, no TLS/JWT) → gates, ladder; real traffic shape.
- Retry storm at go-live → backoff, jitter; old clients.
- Primary dies → promote replica (drilled); seconds of writes.
- Your login at 10×, local JWT unconfirmed → ask now, cache checks; its outage.
- **[CHG-06]** New-account farming, fake match IDs → absolute weekly payout cap set with you, approval, ≥ 5 wins to promote; polluted week-1 boards.
- Week close, 600k members → rehearse, batch per league; late coins.
