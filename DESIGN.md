<!-- cap: 1000 words -->
# DESIGN: Hexabout Leagues

## 1. Architecture
```
 Host phone ──┐
              ├── HTTPS ──┐
 Guest phone ─┘           ▼
 ┌─── one CCX43, 16 vCPU [CHG-03] ──────────┐
 │ Caddy: TLS, one process per player       │
 │ Node/Fastify API × ~8 processes          │
 │   ├─ leaderboard cache (per process, 2 s)│
 │ PostgreSQL 16                            │
 │ Jobs: week-close · payout · cleanup      │
 └──────┬────────────────────┬──────────────┘
        ▼                    ▼
 Existing backend (black    Async replica, 2nd location
 box): wallet, public key   + daily dump outside Hetzner
```
**Identity (A10):** Leagues verifies the existing login's signed JWT locally with its public key: no network call, works while that backend is down. Cost: a banned player stays valid until expiry; payouts are reviewed anyway. If A10 is wrong: cache each check until expiry [CHG-01].

## 2. Data model
| Table | Key | Index → query it serves |
|---|---|---|
| `weeks` | `week_id` | — (status: open → closing → closed → paying → paid) |
| `player_tiers` | `player_id` | — (tier survives the reset) |
| `leagues` | `league_id` | `(week_id, tier) WHERE member_count < 50` → join |
| `league_members` | `(week_id, player_id)` | `(league_id, points DESC, last_win_at, player_id)` → leaderboard |
| `match_reports` | `(match_id, reporter_id)` | `(created_at)` → 14-day retention delete |
| `match_results` | `match_id` | `(winner_id, loser_id, created_at)` → pair-repeat check |
| `reward_ledger` | `(week_id, player_id, kind)` | `(week_id, status)` → payout batch |
| `settings` | `key` | — (min app version, reset time, tier table, kill switch) |

**Joining a league:** one atomic statement takes an open league (`FOR UPDATE SKIP LOCKED`) and increments `member_count`, so it never reaches 51. Tier-1 leagues are pre-created, 1 h of peak joins ahead [CHG-06].

## 3. API
| Who | Endpoint | Purpose |
|---|---|---|
| Player | `GET /leagues/status` | Enabled? Min version, week end, my tier. Old app → `426 Upgrade Required` |
| Player | `POST /matches/:id/report` | Report a result (idempotent) |
| Player | `GET /leagues/me/leaderboard` | My league, top 50 + my rank |
| Admin | `GET /admin/weeks/:id/payout-preview` | Totals before paying |
| Admin | `POST /admin/weeks/:id/payout/approve` | Release the payout |
| Admin | `POST /admin/payouts/pause` | Kill switch |

## 4. Decisions
**ADR-1: Polling, not WebSockets.** WebSockets bring reconnect storms, sticky sessions, pub/sub fan-out and dropped sleeping phones; polling avoids them and can be cached. Cost: seconds of lag, hidden by the optimistic UI.

**ADR-2: Postgres only, not Postgres + Redis.** A league leaderboard is 50 rows behind one index; one store means one backup, one truth. Redis only if load tests show Postgres is the bottleneck.

**ADR-3: Two agreeing reports, not trusting the host.** The host can lie unchallenged; the guest's copy catches a host that lies only to the server. Cost: a match counts only when both reports arrive. A per-match advisory lock stops two simultaneous reports from missing each other.

**ADR-4: Postgres ledger as the outbox, not Kafka.** The guarantee comes from writing the payout row before calling the wallet (outbox) and the wallet dropping duplicate keys (inbox), not from the transport. Kafka adds a broker for one external call a week; it fits many consumers.

## 5. Handling load
Target: 2,150 rps launch first hour; 5,375 survived by shedding (CAPACITY.md §7) [CHG-02].
- **Cache:** per-league leaderboard per process, 2 s TTL; a result drops it in the recording process, others stay ≤ 2 s stale behind the optimistic +1 [CHG-03].
- **Pools:** 4 per process × 8 ≤ `max_connections` 50 [CHG-03].
- **Rate limits:** per player, 25 reports/hour (a 3-minute match allows at most 20) and 1 leaderboard read per 2 s, counted in memory: Caddy pins each token to one process. Per IP: flood ceiling only (carrier NAT) [CHG-04].
- **Shedding:** server-set polls per match 3 → 1 → 0, then 429 on reads, then Leagues off; reports last [CHG-04].
- **Idempotent reports:** primary key `(match_id, reporter_id)`, so a retry returns `duplicate`.
- **Idempotent coins, crash-safe** (see ADR-4):
  1. **Week close = one transaction:** rank leagues, write one `reward_ledger` row per promoted player, update tiers, set the week to `closed`. Rehearsed at launch size; batch per league if slow [CHG-06].
  2. **Payout guard:** total ≤ leagues × promoted × coins and an absolute weekly cap; 2×-last-week hold after 4 weeks; kill switch; manual approval [CHG-06].
  3. **Payout worker:** claims rows with `FOR UPDATE SKIP LOCKED` and a lease, then moves each row `pending → sending → paid`. Each wallet call sends `Idempotency-Key = sha256(week:player:kind)`.
  4. **Janitor on startup:** a `sending` row past its lease is retried with the same key if the wallet drops duplicates (A9), else marked `uncertain` for a person. Late beats twice.
  5. **Recovery point:** `weeks.status` (§2): a restart resumes there.

- **One-report matches (MVP):** never count; shown greyed out. Cost: a rage-quitter's loss doesn't count either (PRD: Could).

## 6. Single points of failure we accept
| SPOF | Impact | Why accepted | Recovery |
|---|---|---|---|
| Primary server or its location | Leagues down | One engineer; a split keeps the DB a SPOF | Promote the 2nd-location replica (drill timed) [CHG-03] |
| Hetzner account | Servers and backups gone | Rare | Daily dump outside Hetzner, before launch [CHG-03] |
| Existing backend | No payouts, no new logins | Not ours | Payouts resume later; reports keep working (local tokens) |
| Week-close / payout job | Late rewards | Resumable by design (ADR-4) | Restart; check `uncertain` rows |

## 7. Security
- **Who can do what:** the player ID comes only from the verified token, never from the request body. A player reports only matches they played, and reads only their own league. Without this, one cheater could send both "agreeing" reports. Admin: separate token plus IP allowlist.
- **Client results:** never trusted alone: dual report, rate limits, pair-repeat flags, delayed payout.
- **Secrets:** env vars on the server only; `.env.example` in the repo; the wallet API key is never sent to phones.