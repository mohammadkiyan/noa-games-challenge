<!-- cap: 500 words -->
# Change response
`[CHG-0x]` marks changed lines in PRD, DESIGN, CAPACITY.

## What changes
- **[CHG-01] Assumption.** "10× daily players" = 600k DAU every launch-week day, all in Leagues (pessimistic). Replaces the 5× push multiplier.
- **[CHG-02] Load.** 600k × 43 = 25.8M requests/day. First-hour share (assumed) → rps (knee needed at 70%): **30% → 2,150 (3,070): plan**; 75% → 5,375 (7,680): stress. ~12k leagues leave few cache hits: plan on the **cache-off knee, 800 rps** per laptop CPU (`08-knee.txt`, 1 run). Old plan (CPX22, est. ≤ 2,250) fails.
- **[CHG-03] Servers.** **CCX43** (16 dedicated vCPU; est. need 4–7 plan, 9–18 stress). Same-size async replica elsewhere; daily dump outside Hetzner. Built as CCX23 (160 GB disk), rescaled CPU/RAM-only. ≈ €280 for two weeks (one early), far under budget. After: both CCX23 (≈ €195/month) once peak CPU < 17% (70% ÷ 4) for 3 days. If gates fail: CCX53; if DB latency rises at CPU < 70%, separate Postgres.
- **[CHG-04] Degradation ladder**, server-set: (1) polls 3 → 1 per match (−37% requests); (2) polls off, `429 Retry-After` on reads (−56%); (3) Leagues off, game playable. Step up at p95 > 300 ms (2 min), CPU > 70% (5 min) or 5xx > 0.1%; step down after 30 min at p95 < 150 ms, CPU < 50%. Reports shed last.

## What does not change
Core loop, dual report, idempotent atomic writes, Postgres only, polling, coins only on promotion, after week close and approval.

## New cuts and sequencing
- **[CHG-05] Clubs: not in MVP.** Needs membership, group scoring, reward split, UI, abuse rules: est. 20+ days. Lost: the banner's social promise; say "play with friends" only if they already can. Next: league invites, after two stable weeks.
- **Moved before launch:** client levers, backoff/jitter, report resend in the store build (earliest deadline); replica, outside dump, timed restore, failover; pre-created leagues; week close and payout rehearsed.
- **Dropped:** one-report auto rule; anomaly alert (cap instead).
- **Gates** (real box): 2,150 rps × 30 min at p95 < 300 ms, p99 < 800, k6 errors incl. 429 and timeouts < 0.1%, CPU ≤ 70%; 5,375 rps from cold cache, reports in SLO, reads may shed; points = results after each run. Failed gate: same date, launch at the ladder step that passed.

## New risks (→ mitigation; left over)
- Launch build lacks levers → ship first; else only 429s.
- Real capacity unknown (laptop, one run, no TLS/JWT) → gates, ladder; real traffic shape.
- Retry storm at go-live → backoff, jitter; old clients.
- Primary dies → OPS B: fence, payouts off, clients resend; unreplicated writes lost.
- Your login at 10×, local JWT unconfirmed → ask now, cache checks; its outage.
- **[CHG-06]** New-account farming, fake match IDs → weekly payout cap (with you), approval, ≥ 5 wins to promote; polluted week-1 boards.
- Week close, 600k members → resumable per-league close, rehearsed; late coins, delayed joins.
- A9 unconfirmed → `uncertain` rows, manual match; late coins.
