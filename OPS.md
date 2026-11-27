<!-- cap: 500 words -->
# Operations
All **proposed** for CHG-03 (CCX43, replica, outside dump); nothing exists yet. Recovery times are targets until drilled.

## 1. Observe
Grafana Cloud with Alloy: logs, host/Postgres metrics, external probe, paging.
- **Logs:** existing pino JSON plus report outcome, job state, ledger transitions. No tokens, keys or bodies; IPs truncated.
- **Metrics:** hand-written `/metrics` (no dependency): latency and status per endpoint, 429s, event-loop delay, throttling, pool waits, disk, replica lag, backup age, ledger status, exposure. No per-player labels.
- **Invariant, hourly:** Σ points = results won by league members.

**SLO** (per endpoint, 5-min windows): p95 < 300 ms, p99 < 800 ms, 5xx < 0.1%. 409 is good; 429 is shed (degraded), not an error.

**Page:** report 5xx > 1% for 5 min · `/healthz` down 2 min · CHG-04 trigger (launch week) · disk > 90% · replication down 30 min · invariant mismatch · exposure > cap.
**Working hours:** replica lag > 60 s · backup > 26 h old · `uncertain` payout rows.

## 2. Deploy and rollback
CI today: typecheck, migrate a fresh DB, tests, docs-check; no deploy. Add: SHA-tagged GHCR image; manual `deploy <sha>` migrates once (advisory lock), restarts processes one by one behind Caddy health checks, smoke-tests.
- **Migrations:** forward-only expand/contract with `lock_timeout`; big indexes `CONCURRENTLY` outside the runner; nothing destructive in launch week.
- **Rollback:** previous SHA (target ≤ 10 min) or a `settings` flag (seconds). Schema changes and restores are never rollbacks.
- **Restarts** reset cache and rate limits. Cold reads are ≈ 76× slower (0.917 ÷ 0.012 ms/block, `evidence/06` vs `02`): warm with the k6 `smoke` profile.

## 3. Recovery
- **Primary or location lost:** promote the replica. RPO = lag at failure (unbounded). RTO 30 min.
- **Corruption or bad delete:** restore to an isolated DB, repair. RPO 24 h. RTO 2 h.
- **Hetzner account lost:** outside dump at a new provider. RPO 24 h. RTO 1 day.

Extra dumps after week close and payout. Restore drill before launch, then monthly; record minutes here.
**Scaling:** raise limits early; rescale CPU/RAM-only a week before launch (time the downtime), rerun the gates, warm, freeze. Scale down per CHG-03, with a healthy replica and fresh dump.

## 4. Runbooks
**A. Overload:** freeze deploys; step up the ladder; reports shed last; CCX53 only if pre-tested.
**B. Primary down:** pause payouts; fence the old primary (API power-off); promote; start the pre-deployed app; DNS (60 s TTL). Replay lost `recorded` results from shipped logs; verify the invariant; rebuild it as a replica; run C.
**C. Payout anomaly:** kill switch; dump the ledger. Non-`paid` rows: same-key resend if A9 holds, else `uncertain`, reconciled with the wallet. Resume after approval; never retry blind.

## 5. 2 a.m.
Pages: the §1 list. Waits: stale boards, late coins. Refused: untested changes, unreviewed migrations, destructive SQL without a dump, blind retries, peak deploys.
**Maintenance:** monthly dependency PR through CI; security fixes by severity; minor upgrades after a dump and replica check; none 2 weeks before launch.
