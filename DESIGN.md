<!-- cap: 1000 words -->
# DESIGN: Hexabout Leagues

## 1. Architecture
```
 Host phone ──┐
              ├── HTTPS ──┐
 Guest phone ─┘           ▼
 ┌─── one CPX02 box ────────────────────────┐
 │ Caddy: TLS, per-IP rate limit            │
 │   ▼                                      │
 │ Node/Fastify API                         │
 │   ├─ leaderboard cache (in-process, 2 s) │
 │   ▼                                      │
 │ PostgreSQL 16                            │
 │ Jobs: week-close · payout · cleanup      │
 └──────┬────────────────────┬──────────────┘
        ▼                    ▼
 Existing backend (black    Backups: Hetzner daily
 box): wallet, public key   + off-site pg_dump
```
**Identity (A10):** Leagues verifies the existing login's signed JWT locally with its public key: no network call; works while that backend is down. Cost: a banned player stays valid until the token expires; fine, since payouts are delayed and reviewed.

## 2. Data model
| Table | Key | Index → query it serves |
|---|---|---|
| `weeks` | `week_id` | — (status: open → closing → closed → paying → paid) |
| `player_tiers` | `player_id` | — (tier survives the reset) |
| `leagues` | `league_id` | `(week_id, tier) WHERE member_count < 50` → find an open league to join |
| `league_members` | `(week_id, player_id)` | `(league_id, points DESC, last_win_at, player_id)` → leaderboard |
| `match_reports` | `(match_id, reporter_id)` | `(created_at)` → 14-day retention delete |
| `match_results` | `match_id` | `(winner_id, loser_id, created_at)` → "same pair keeps winning" check |
| `reward_ledger` | `(week_id, player_id, kind)` | `(week_id, status)` → payout batch |
| `settings` | `key` | — (min app version, reset time, tier table, kill switch) |

**Joining a league:** one atomic statement takes an open league (`FOR UPDATE SKIP LOCKED`) and increments `member_count`, so it never reaches 51.

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
**ADR-1: Polling, not WebSockets.** WebSockets are stateful: reconnect storms on deploy, sticky sessions, pub/sub fan-out, sleeping phones dropping connections. Polling avoids all four and can be cached. Cost: seconds of lag, hidden by the optimistic UI.

**ADR-2: Postgres only, not Postgres + Redis.** A league leaderboard is 50 rows behind one index. One store: one backup, one source of truth. Redis sorted sets only if load tests show Postgres is the bottleneck. Also rejected: Nakama + Hiro (paid, new to learn).

**ADR-3: Two agreeing reports, not trusting the host.** The host can lie unchallenged; the guest's copy catches a host that lies only to the server. Cost: a match counts only when both reports arrive. A per-match advisory lock stops two simultaneous reports from missing each other.

**ADR-4: Postgres ledger as the outbox, not Kafka.** The guarantee comes from writing the payout row before calling the wallet (outbox) and the wallet dropping duplicate keys (inbox), not from the transport. Kafka adds a broker bigger than our box for one external call a week. More job types → pg-boss. Kafka fits when several services consume our events.

## 5. Handling load
Target: ~540 rps push peak (CAPACITY.md).
- **Cache:** per-league leaderboard in app memory, 2 s TTL, dropped when that league records a result. One app instance only.
- **Off-request work:** week close, payout and cleanup run as jobs, never in a request.
- **Rate limits:** per player, 25 reports/hour (a 3-minute match allows at most 20) and 1 leaderboard read per 2 s. Per IP at Caddy.
- **Idempotent reports:** primary key `(match_id, reporter_id)`, so a retry returns `duplicate`.
- **Idempotent coins, crash-safe** (see ADR-4):
  1. **Week close = one transaction:** rank leagues, write one `reward_ledger` row per promoted player, update tiers, set the week to `closed`. A crash rolls everything back.
  2. **Payout guard:** total ≤ leagues × promoted × coins; hold if > 2× last week; kill switch; manual approval for the first weeks.
  3. **Payout worker:** claims rows with `FOR UPDATE SKIP LOCKED` and a lease, then moves each row `pending → sending → paid`. Each wallet call sends `Idempotency-Key = sha256(week:player:kind)`.
  4. **Janitor on startup:** a `sending` row past its lease is retried with the same key if the wallet drops duplicates (A9), else marked `uncertain` for a person. Late beats twice.
  5. **Recovery point:** `weeks.status` (§2), so a restart resumes in place.

- **One-report matches (MVP):** never count; shown greyed out. Cost: a rage-quitter's loss doesn't count either (PRD: Could).

## 6. Single points of failure we accept
| SPOF | Impact | Why accepted | Recovery |
|---|---|---|---|
| The one CPX02 (app + DB) | Leagues down | Cost; load is small | Restore from backup; time measured in the OPS.md drill |
| Hetzner region | Leagues down | One engineer can't run multi-region | Restore elsewhere from off-site dump |
| Hetzner account (suspension, billing) | Server and all backups gone | Off-site dump is still Hetzner; MVP cost | Later: weekly dump outside Hetzner |
| Existing backend | No payouts, no new logins | Not ours | Payouts resume later; local token checks keep reports working |
| Week-close / payout job | Late rewards | Resumable by design (ADR-4) | Restart; check `uncertain` rows |

## 7. Security
- **Who can do what:** the player ID comes only from the verified token, never from the request body. A player reports only matches they played, and reads only their own league. Without this, one cheater could send both "agreeing" reports. Admin endpoints need a separate admin token plus an IP allowlist.
- **Client results:** never trusted alone: dual report, rate limits, pair-repeat flags, delayed payout.
- **Secrets:** env vars on the server only; `.env.example` in the repo; the wallet API key is never sent to phones.