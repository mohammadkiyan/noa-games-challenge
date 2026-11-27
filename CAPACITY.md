<!-- cap: 500 words -->
# CAPACITY: Hexabout Leagues
**Measured** = `evidence/` (`12` default); **Est.** = math.

## 1. Assumptions
- **C1** 8 matches/player/day **C2** 1 report, **C3** 4 reads per player-match (after match + 3 polls).
- **C4** 3 other calls/player/day. **C5** peak hour 15% of daily.
- **C6** 5× later pushes (A4); launch: §7 [CHG-01]. **C8** 14-day retention.
- **C7** 188 B/report (pre-003), 178 B/result incl. indexes. **C9** DB ms/request 0.786 (540 rps), 1.484 cache-off (`07`). Measured.
- **C10** Safe = 70% of knee.

## 2. Requests (60k DAU)
- Per player/day: 8 + 8×4 + 3 = **43** → 2.58M/day
- Peak: 2.58M × 15% ÷ 3,600 = **108 rps**; push ×5 = **540 rps**

## 3. One box (1 CPU, 1 GB)
- **Knee 1,200 rps** (1 run, CPU quota, `11`). 540 rps: CPU 56% (Node 69%, Postgres 31%).
- **Safe: 0.7 × 1,200 = 840 rps ≈ 93k DAU.**

## 4. Storage (60k)
- Per day: 480k × 188 B + 240k × 178 B = **133 MB**; 14 days **1.86 GB**.

## 5. Monthly cost (EUR excl. VAT, Hetzner 2026-11-27) [CHG-03]
| DAU | Server | Infra + AI/month |
|---|---|---|
| 1k | CPX02 6.49 | €10.99 + $40 |
| 10k | CPX02 6.49 | €10.99 + $40 |
| 100k | CPX22 19.99 | €27.19 + $40 |
| **60k, post-launch** | 2 × CCX23 86.49 | €193.48 + $40 |

Infra = servers + primary backups 20% + Storage Box 3.20; other rows sizing-only. Launch: 2 × CCX43 × 0.3766/h × 336 h = 253 + backups 25 ≈ **€280**.
AI budget: [Claude Pro](https://claude.com/pricing) $20 + [ChatGPT Plus](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus) $20 list prices, actual billing unknown. Add €25/month allowance (outside dump/monitoring). With 27% VAT: infra €277/month, €387 launch; within $500/$2,000 if EUR/USD < 1.80/5.1. AI separate.

## 6. Where cost jumps
- **~93k DAU** → CPX22: knee ≤ 1,200 ÷ (0.801 × 0.667 Node CPU) ≈ **2,250 rps, safe ≤ 1,570 ≈ 175k DAU** (split frees Postgres's 31%).

## 7. Launch week (600k DAU, est.) [CHG-02]
- 600k × 43 = **25.8M/day**. First-hour share **30% (plan)** / 75% (stress) → **2,150** / 5,375 rps; knee ÷ 0.7: **3,070** / 7,680.
- **Basis: cache-off knee 800 rps, CPU 93.3%** (`08-knee.txt`, 1 run): ≥ 12k leagues over ~8 caches leave few hits.
- CPU: 0.933 ÷ 800 ≈ 1.17 cores/1k rps; ÷ 0.7: 3.6 plan, 9.0 stress; assumed 0.5–1 laptop core per vCPU, linear (unproven): **4–8 vCPU plan, 9–18 stress** → CCX43 (16).
- Busy connections: 2,150 × 1.484 ms = 3.2; 5,375 → 8.0 (pools 32).
- Storage: 4.8M × 188 B + 2.4M × 178 B = **1.33 GB/day**; 14 days 18.6 GB. Set `max_slot_wal_keep_size`; 160 GB disk.
- **Onboarding unmeasured** (≤ 600k new: JWT, joins, league creation, cold reads); margin 16 vs 4–8 vCPU until gated.
- **Weekly members** (0.6M same daily; 1.2M illustrative; 4.2M disjoint) → ≥12k/24k/84k leagues: joins, close, cache, exposure. DAU drives rps/storage. Rehearse 4.2M (0.66 GB at 157.8 B, `08`).
