<!-- cap: 500 words -->
# CAPACITY: Hexabout Leagues
**Measured** = laptop runs in `evidence/`, `12-target-cache.txt` unless named. **Est.** = math.

## 1. Assumptions
- **C1** 8 matches/player/day **C2** 1 report/player-match.
- **C3** 4 leaderboard reads/player-match: after match + 3 polls.
- **C4** 3 other calls/player/day. **C5** 15% of daily traffic in peak hour.
- **C6** 5× later pushes (A4); launch: §7 [CHG-01]. **C8** 14-day retention.
- **C7** 188 B/report, 178 B/result incl. indexes. **C9** DB time/request 0.786 ms at 540 rps; 1.484 cache-off (`07`). Measured.
- **C10** Safe load = 70% of knee.

## 2. Requests (60k DAU)
- Per player/day: 8 + 8×4 + 3 = **43** → 2.58M/day
- Peak: 2.58M × 15% ÷ 3,600 = **108 rps**; push ×5 = **540 rps**

## 3. One box (1 CPU, 1 GB)
- **Knee 1,200 rps** (1 run); 1,300: p95 576 ms (`11-knee-cache.txt`). At 540 rps: p95 3.8 ms, CPU 56% (Node 69%, Postgres 31%).
- **Safe: 0.7 × 1,200 = 840 rps ≈ 93k DAU.** 0 OOM kills.

## 4. Storage and connections (60k)
- Per day: 480k × 188 B + 240k × 178 B = **133 MB**; 14 days **1.86 GB**; as `uuid` ×0.91 / ×0.78 → 1.62 GB (`id-size.txt`).
- Little's law: 541 rps × 0.786 ms = **0.43 busy connections**.

## 5. Monthly cost (EUR excl. VAT, Hetzner 2026-11-27) [CHG-03]
| DAU | Server | Total |
|---|---|---|
| 1k, 10k | CPX02 6.49 | 10.99 |
| 60k | CPX02, CPX22 pushes | 10.99 + 0.44/push day |
| 100k | CPX22 19.99 | 27.19 |
| After launch | 2 × CCX23 86.49 | 193.48 |

Total = server (IPv4 incl.) + primary backups 20% + Storage Box 3.20. Push day: (19.99 − 6.49) ÷ 730 h × 24 h. Launch: 2 × CCX43 × 0.3766/h × 336 h = 253 + backups 25 ≈ **280**.

## 6. Where cost jumps
- **Measured ~93k DAU.** Limit: CPU quota (`11` `thr%` 9.1% → 35.5% at 1,300 rps).
- **Then vertical** (CPX22): a split frees only Postgres's 31%. Node used 0.801 × 0.667 = 0.53 CPU at 1,200 rps, so **knee ≤ 1,200 ÷ 0.53 ≈ 2,250 rps → safe ≤ 1,570 ≈ 175k DAU**.

## 7. Launch week (600k DAU, est.) [CHG-02]
- 600k × 43 = **25.8M requests/day**. First-hour share **30% (plan)** / 75% (stress) → **2,150** / 5,375 rps; knee ÷ 0.7: **3,070** / 7,680.
- **Basis: cache-off knee 800 rps, CPU 93.3%** (`08-knee.txt`, 1 run): 12k leagues over ~8 caches leave few hits.
- CPU: 0.933 ÷ 800 ≈ 1.17 cores per 1k rps; ÷ 0.7 → 3.6 plan, 9.0 stress. At 0.5–1 laptop core per vCPU, linear scaling (both unproven): **4–7 vCPU plan, 9–18 stress** → CCX43 (16).
- Connections: 2,150 × 1.484 ms = 3.2 busy; 5,375 → 8.0. Pools 4 × 8 = 32 ≤ `max_connections` 50.
- Storage: 4.8M × 188 B + 2.4M × 178 B = **1.33 GB/day**; 14 days 18.6 GB. Set `max_slot_wal_keep_size`; 160 GB disk.
