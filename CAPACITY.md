<!-- cap: 500 words -->
# CAPACITY: Hexabout Leagues
**Measured** = load test of the starting state in `evidence/` (each file starts with its reproduce command). **Est.** = math, re-measured in production.

## 1. Assumptions
- **C1** 8 matches/player/day (brief). **C2** 1 report/player-match (dual report).
- **C3** 4 leaderboard reads/player-match: open after match + 3 polls, 10 s apart.
- **C4** 3 other calls/player/day.
- **C5** 15% of daily traffic in peak hour: deliberately pessimistic (flat day = 4.2%).
- **C6** 5× marketing push (A4). **C8** 14-day retention (payout + disputes).
- **C7** 188 B/report, 178 B/result incl. indexes. Measured.
- **C9** DB time/request 0.79 ms mean, 2.51 ms p95 at 540 rps. Measured.
- **C10** Safe load = 70% of knee (judgment: headroom).

Measured values: `evidence/12-target-cache.txt` unless named.

## 2. Requests (60k DAU)
- Per player/day: 8 + 8×4 + 3 = **43** → 2.58M/day
- Normal peak: 2.58M × 15% ÷ 3,600 = **108 rps**; push ×5 = **540 rps** (~108 writes/s)
- **9 push-peak rps per 1k DAU**

## 3. One box (1 CPU, 1 GB)
- **Knee 1,200 rps** measured; 1,300 fails at p95 576 ms (`11-knee-cache.txt`). At 540 rps: p95 3.8 ms, CPU 56% (Node 69%, Postgres 31%).
- **Safe: 0.7 × 1,200 = 840 rps ≈ 93k DAU.** Normal peak has 7.8× margin; a push uses 64%.
- **Est.: a real CPX02 is slower** than the laptop i7-1255U core tested. Until measured, resize to CPX22 before planned pushes (OPS.md).
- **RAM:** `memory.max` hits are page-cache eviction; 0 OOM kills. Hot set: `league_members`, 9.5 MB.

## 4. Storage and connections
- Per day: 480k × 188 B + 240k × 178 B = **133 MB**; 14 days: **1.86 GB** + WAL ≤ 1 GB.
- Seeded player IDs are short. UUIDs as text: ×1.77 / ×1.36 → 3.05 GB; as `uuid` type: ×0.91 / ×0.78 → **1.62 GB** (`id-size.txt`). Use `uuid`.
- Little's law: 541 rps × 0.786 ms = **0.43 busy connections**; measured average 0.28, max 2. Pool 10 is ample.

## 5. Scale and monthly cost (EUR excl. VAT)
- **1k DAU:** 9 rps, 0.03 GB. **10k:** 90 rps, 0.31 GB. Both: CPX02 €5.99 + IPv4 €0.50 + backups €1.20 + Storage Box BX11 dump €3.20 = **€10.89**.
- **60k:** 540 rps, 1.86 GB. CPX02, rescaled to CPX22 for pushes (billed hourly).
- **100k:** 900 rps, 3.10 GB. CPX22 €19.49 + €0.50 + €3.90 + €3.20 = **€27.09**.
- Monitoring: Grafana Cloud free, €0. Claude Pro $20 always.

## 6. Where cost jumps
- **CPU first, at ~93k DAU.**
- **Then vertical, not split:** CPX22 (2 vCPU, 4 GB): one server, one backup, no network hop. Splitting off Postgres frees only its 31%. Node is single-threaded and used 0.80 × 0.67 = 0.53 CPU at 1,200 rps, so **est. knee ≈ 1,200 ÷ 0.53 ≈ 2,260 rps → safe 1,580 ≈ 176k DAU**.
- **Production tests:** one hour each on a real CPX02 and CPX22; pin to P- vs E-cores to explain run-to-run p95 swings.
