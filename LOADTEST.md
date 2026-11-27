<!-- cap: 500 words -->
# Load test
Figures: `evidence/`; raw data: `.runs/`.

## 1. Scenario and mix
k6 arrival-rate (`slice/loadtest/scenario.js`): offered load stays fixed when the server slows; unsent requests count as dropped.
- **80% leaderboard reads:** polling dominates (CAPACITY C3).
- **20% reports, in concurrent pairs** (tests the advisory lock): one 201 and one 202 per pair.
- **~1% duplicates:** 200, no points added.
- Not covered: joins, JWT, wallet, week close.

**Target:** 540 rps (CAPACITY §2). **Knee:** +100 rps/min until p95 > 300 ms or errors > 1% (looser than the SLO).

## 2. Machine and data
Laptop i7-1255U; app and Postgres 16 in one container, `--cpus=1`, 1 GiB, no swap; k6 on the same host. Seed: 60k players, 1,200 leagues, 1.44M results, 2.889M reports, 779 MiB (`seed.txt`); 852 MiB by run 12.

## 3. Results
Target 540 rps, 0% errors:
- **02 baseline:** p95 6.0 / p99 10.0 ms, CPU 79.6%, 0 dropped.
- **07 + SQL function:** 3.6 / 32.4 ms, CPU 74.4%, **32 dropped**: zero errors ≠ all load served.
- **12 + cache:** 3.8 / 5.9 ms, CPU 56.4%, 0 dropped.

Knee (p95 at 800): **03** 800 (79.6 ms) · **08** 800 (12.9 ms) · **11** 1,200 (3.8 ms). Run 11 at 1,300: 1,243 achieved, p95 576 ms.

## 4. Bottleneck and fix
**Bottleneck: the CPU quota** (`04-profile.txt`). At 700 rps: CPU 92%, throttled 31% of periods; pool wait was a symptom. Memory, disk, connections: not limiting. 81% of Postgres CPU was outside statement execution; reports were 20% of requests but 60% of round trips.

**Fix: `report_match()`** (migration 002): one round trip instead of ~6, same guarantees (advisory lock held to commit, `ON CONFLICT` → `duplicate`, result row and `points = points + 1` in one transaction).

**Impact (03 → 08, same protocol):** p95 at 800 fell 79.6 → 12.9 ms, throttling 74.5% → 36.0%, but **the knee stayed at 800** (825 failed, run 10). At target, p99 rose 10.0 → 32.4 ms, confounded by a cold page cache (block reads 0.012 → 0.614 ms).

**Cache** (2 s TTL) cuts SQL per read, not requests: 40.7% of reads skipped SQL (run 12). The 1,200 knee is one run, confounded by a warm-up and a larger database.

## 5. Reproduce
```sh
make box-up && make box-seed
make measure PROFILE=knee KNEE_START=400 KNEE_STEP=100 KNEE_WARMUP=60 LABEL=knee-cache
```
`make box-up LEADERBOARD_CACHE_MS=0` turns the cache off. Tests today's code only: no run recorded its git revision; the baseline (02–04) is not in history.

## 6. What this does not tell
- **Cloud CPU:** run 13 (interrupted, pinned to one logical CPU, `.runs/13-knee-pcore/k6.txt`): p95 167 ms at 600 rps vs 4.1 ms unpinned; effect size unknown.
- **Repeatability:** the cache-off 800 step failed once from cold (run 09).
- **Production:** no TLS, Caddy, multi-process, replica, network.
- **Scale:** 60k players, not 600k; 2-minute holds; synthetic cache locality.

1,200 rps is not production capacity; 840 is an estimate (CAPACITY §3); launch sizing uses 800 (§7). 2,150 and 5,375 rps stay unverified until the CHANGE-RESPONSE gates pass.
