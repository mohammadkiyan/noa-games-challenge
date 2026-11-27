<!-- cap: 500 words -->
# Operations
All **proposed** for CHG-03 (times are untested targets); the slice has only `/healthz` (`SELECT 1`) and pino logs.

## 1. Observe (Grafana Cloud, Alloy)
- **Logs:** pino JSON plus job and ledger transitions; no secrets or bodies; IPs truncated.
- **Metrics** (`/metrics`, no per-player labels): latency, status, ladder step, CPU, pool waits, disk, replica flush lag, backup age, ledger, exposure.

**SLO** (per endpoint, 5 min): p95 < 300 ms, p99 < 800 ms, errors < 0.1% (5xx, timeouts, failed probes). 409 is an answer; 429 is shed, tracked per ladder step.

**Page:** report errors > 1%, 5 min · probe down 2 min · CHG-04 trigger · disk > 90% · replication down or flush lag > 60 s, 5 min · hourly Σ points ≠ results won · exposure > cap.
**Working hours:** backup > 26 h or restore test failed · `uncertain` payouts.

## 2. Deploy and rollback
CI exists; to add: `deploy <sha>` migrates once, restarts processes singly behind Caddy health checks.
- **Migrations:** forward-only expand/contract, `lock_timeout`, big indexes `CONCURRENTLY`; nothing destructive at launch.
- **Rollback:** previous SHA (target ≤ 10 min) or a `settings` flag; never a schema change or restore.
- **Restarts** reset cache and rate limits; cold block reads are ≈ 76× slower (0.917 ÷ 0.012 ms/block, `evidence/06` vs `02`): warm with `pg_prewarm`, never k6 (it writes reports). Probe: `/healthz` plus a read as a payout-excluded account.
- **Upgrades:** monthly PR; frozen 2 weeks before launch, except security fixes.

## 3. Recovery
Async replication loses acknowledged writes the replica has not flushed (unmeasured; unbounded while lagging); replay lag only delays promotion.
- **Primary or location lost:** promote. RPO objective 60 s (alerted, not guaranteed); RTO 30 min + DNS caching.
- **Corruption or bad delete:** restore to an isolated DB, repair. RPO 24 h; RTO 2 h.
- **Hetzner account lost:** outside dump to a new provider (credentials off Hetzner). RPO 24 h; RTO 1 day.

Dump RPOs assume a complete, test-restored dump. Extra dumps after week close and payout; restore drill pre-launch, then monthly. Promoted or restored DBs start with payouts off, no wallet key.

## 4. Runbooks
Never at 2 a.m.: untested changes, undumped destructive SQL, blind retries, peak deploys.
**A. Overload:** freeze deploys; step up the ladder; CCX53 only if pre-tested.
**B. Primary down:** pause payouts; confirm Postgres is down from the replica host; fence by provider API: power-off or deny-all firewall, confirmed (DNS is not fencing); unconfirmed: never promote; clients keep reports; old box never rejoins; replica replayed all received WAL; promote; start the app; DNS (60 s TTL). Bump the `settings` epoch: clients resend kept reports with their week (idempotent); unresent losses stand, announced. Hold week close for resends; verify the invariant; rebuild a replica; run C if paying.
**C. Payout anomaly:** kill switch; dump the ledger; rerun close for missing leagues (same keys). Non-`paid` rows: same-key resend only if A9 holds (durable, ≥ 30 days), else `uncertain` until matched to wallet records; resume after approval.
