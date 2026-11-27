<!-- cap: 500 words -->
# Load test
Figures: `evidence/`; raw data: `.runs/`.

## 1. Scenario and mix
k6 arrival-rate (`slice/loadtest/scenario.js`): fixed offered load.
- **80% leaderboard reads** (CAPACITY C3); **20% reports** as concurrent agreeing pairs (advisory lock), expecting 201 + 202; **~1% duplicates**, expecting 200.
- Not covered: disagreements, joins, JWT, wallet, week close.

k6 checks status codes only; `slice/test/reportMatch.test.ts` proves duplicate safety, single results, atomic points, disputes.

**Target:** 540 rps (CAPACITY §2). **Knee:** +100 rps/min until p95 > 300 ms or errors > 1%.

## 2. Machine and data
Laptop i7-1255U; app and Postgres 16 in one container: `--cpus=1` quota (not a dedicated vCPU), 1 GiB, no swap; k6 on the host. Seed: 60k players, 1,200 leagues, 1.44M results, 2.89M reports; 779 MiB (`seed.txt`), 852 by run 12.

## 3. Results
120 s hold, ms; Errors = failed HTTP requests:

| Run | Target | Achieved | p95 | p99 | Errors | Dropped | CPU |
|---|---:|---:|---:|---:|---:|---:|---:|
| 02 baseline | 540 | 540.9 | 6.0 | 10.0 | 0% | 0 | 79.6% |
| 07 +function | 540 | 540.8 | 3.6 | 32.4 | 0% | 32 | 74.4% |
| 12 +cache | 540 | 541.1 | 3.8 | 5.9 | 0% | 0 | 56.4% |

Dropped = unsent iterations (a read or a 2–3-request pair); 0% errors ≠ full load.

Knee: **03** 800; **08** 800; **11** 1,200 (one cache-on run). Run 11 failed at 1,300 (p95 576 ms, CPU 86.7%; cause unknown).

## 4. Bottleneck and fix
**Initial bottleneck: CPU quota** (run 03, `04-profile.txt`): at 700 rps CPU 92%, throttled ~31%; pool wait and loop delay were symptoms. Disk and connections were not limiting; memory.max hits unsampled. Reports: 20% of requests, 60% of round trips. The ~81% non-execution Postgres CPU is a mixed-scope estimate (step-5 split, whole-run `pg_stat_statements`).

**Fix: `report_match()`** (migration 002): one round trip instead of ~6. **Impact (03 → 08):** p95 at 800 fell 79.6 → 12.9 ms, throttling 74.5% → 36.0%; **the knee stayed at 800** (825 failed, run 10).

**Secondary: page cache.** The 1 GiB cgroup ran full (03: 999 MiB, anon 82, `samples.csv`). Run 07's p99 rise coincided with block reads slowing 0.012 → 0.614 ms. Runs 08–12 hit memory.max; OOM kills: 0 where recorded (11–13). Confounders: cold restarts, database growth, uneven warm-up.

**Cache** (2 s TTL): 40.7% of reads skipped SQL (run 12).

## 5. Reproduce
```sh
make box-up && make box-seed
make measure PROFILE=knee KNEE_START=400 KNEE_STEP=100 KNEE_WARMUP=60 LABEL=knee-cache
```
Runs recorded `git=none`; baseline 02–04 is not in history.

## 6. What this does not tell
- **Cloud CPU:** run 13 (interrupted, one pinned logical CPU, `.runs/13-knee-pcore/k6.txt`): p95 167 ms at 600 rps vs 4.1 ms unpinned (run 11).
- **Repeatability:** one run per knee; cache-off 800 failed once from cold (run 09).
- **Code:** runs predate migration 003; tested, not benchmarked.
- **Scope:** no TLS, Caddy, replica, network; 60k of 600k players; 2-minute holds.

1,200 rps is not production capacity; launch sizing uses 800, unverified until CHANGE-RESPONSE gates pass.
