<!-- cap: 500 words -->
# Operations

## Logs, metrics, SLOs, alerts

## CI/CD and rollback time

## Top 3 failure runbooks

## Capacity rules (from CAPACITY.md)
- **Planned push:** the day before, rescale CPX02 → CPX22 with "CPU and RAM only" (keeps the disk, so it can scale back). Warm the cache, then rescale back after the push. Billed hourly. Never pick "upgrade disk": a bigger disk can't shrink, so the box could never return to CPX02.
  - Rescale needs the server powered off: a few minutes of downtime each way. Do it at the quietest hour (from metrics), behind a status notice.
  - Drill once before the first push: time power-off → rescale → boot → `/healthz` OK, and write the measured minutes here.
- **No restarts or deploys during a push.** After any restart, reads are ~60× slower until the cache is warm: 0.92 vs 0.015 ms per block (`evidence/06-target.txt` vs `02-target.txt`). Warm it by running the k6 `smoke` profile against the box before traffic arrives. (`pg_prewarm`, a Postgres contrib extension, would do it at startup; not installed, needs approval.)
- **Alert:** box CPU above 70% for 5 minutes means we are at the safe limit.

## 2 a.m. plan
