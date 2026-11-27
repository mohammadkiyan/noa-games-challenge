<!-- cap: 500 words -->
# CAPACITY: Hexabout Leagues
**Measured** = laptop runs in `evidence/`, `12-target-cache.txt` unless named. **Est.** = math.

## 1. Assumptions
- **C1** 8 matches/player/day (brief). **C2** 1 report/player-match (dual report).
- **C3** 4 leaderboard reads/player-match: open after match + 3 polls, 10 s apart.
- **C4** 3 other calls/player/day.
- **C5** 15% of daily traffic in peak hour: pessimistic (flat day = 4.2%).
- **C6** 5× marketing push (A4). **C8** 14-day retention (payout + disputes).
- **C7** 188 B/report, 178 B/result incl. indexes. Measured.
- **C9** DB time/request 0.786 ms mean, 2.513 ms p95 at 540 rps. Measured; p95 = cache-off `07` (2.511): set by report writes.
- **C10** Safe load = 70% of knee (judgment).

## 2. Requests (60k DAU)
- Per player/day: 8 + 8×4 + 3 = **43** → 2.58M/day
- Normal peak: 2.58M × 15% ÷ 3,600 = **108 rps**; push ×5 = **540 rps**
- **9 push-peak rps per 1k DAU**

## 3. One box (1 CPU, 1 GB)
- **Knee 1,200 rps** measured (1 run); 1,300: p95 576 ms (`11-knee-cache.txt`). At 540 rps: p95 3.8 ms, CPU 56% (Node 69%, Postgres 31%).
- **Safe: 0.7 × 1,200 = 840 rps ≈ 93k DAU.** Normal peak: 7.8× margin; push: 64%.
- **Est.: a real CPX02 is slower** than the laptop i7-1255U; resize to CPX22 before pushes (OPS.md).
- **RAM:** `memory.max` hits are page-cache eviction; 0 OOM kills; hot set `league_members`, 9.5 MB.

## 4. Storage and connections
- Per day: 480k × 188 B + 240k × 178 B = **133 MB**; 14 days: **1.86 GB** + WAL ≤ 1 GB.
- With UUIDs as text: ×1.77 / ×1.36 → 3.05 GB; as `uuid` type: ×0.91 / ×0.78 → **1.62 GB** (`id-size.txt`). Use `uuid`.
- Little's law: 541 rps × 0.786 ms = **0.43 busy connections**; measured 0.28 avg, 2 max; pool 10 is ample.

## 5. Monthly cost (EUR excl. VAT; Hetzner list, re-check)
| DAU | Server | Total |
|---|---|---|
| 1k, 10k | CPX02 5.99 | 10.89 |
| 60k | CPX02; CPX22 on pushes | 10.89 + 0.44/push day |
| 100k | CPX22 19.49 | 27.09 |

Total = server + IPv4 0.50 + backups (20%) + Storage Box 3.20. Push day: (19.49 − 5.99) ÷ 730 h × 24 h. 14-day data: 31 MB per 1k DAU. Grafana Cloud free; Claude Pro $20.

## 6. Where cost jumps
- **Measured: ~93k DAU. Planned: 60k pushes, until real-box tests.** Limit = CPU quota: average CPU 80% at the knee, yet quota hits rose 9.1% → 35.5% of 100-ms periods at 1,200 → 1,300 rps (`11`, `thr%`).
- **Then vertical, not split:** CPX22 (2 vCPU, 4 GB), one server; a split frees only Postgres's 31%. Single-threaded Node used 0.801 × 0.667 = 0.53 CPU at 1,200 rps (step 9), so **est. knee ≤ 1,200 ÷ 0.53 ≈ 2,250 rps (upper bound) → safe ≤ 1,570 ≈ 175k DAU**.
- **Production tests:** an hour each on CPX02 and CPX22; knee 3× (median).
