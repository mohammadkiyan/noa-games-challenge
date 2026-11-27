# Hexabout Leagues: take-home slice

A thin vertical slice of weekly leagues: players report match results and read their league's leaderboard.
Node 22 + TypeScript + Fastify + raw SQL on Postgres 16; design and evidence live in the docs next to this file.

Needs Docker (with compose) and, for tests, Node ≥ 22.18 with npm. Copy `.env.example` to `.env` to change ports or credentials.

## Run

```sh
make up     # Postgres + app in Docker on :3000, migrations applied, 500 players seeded
make down
```

## Test

```sh
make test       # Vitest against a throwaway database, created and dropped per run
make typecheck
make docs-check # word caps on the docs
```

Load tests (`make box-up`, `make measure`) are described in LOADTEST.md.

## Endpoints

Auth is a header: `X-Player-Id: <player id>`.

Report a match result (both players report; points are awarded when the second, agreeing report arrives):

```sh
curl -X POST localhost:3000/matches/m-123/report \
  -H 'X-Player-Id: p1' -H 'Content-Type: application/json' \
  -d '{"opponentId":"p2","winnerId":"p1"}'
# 202 waiting_for_opponent · 201 recorded · 200 duplicate · 409 disputed · 400 bad winner
```

A report is one SQL call (`report_match()`, migrations 002 and 003) under a per-match advisory lock; the winner's points rise by `points = points + 1` only when the match result row is first inserted.

Read my league's leaderboard (top 50 plus my own rank; 404 if I have no league this week):

```sh
curl localhost:3000/leagues/me/leaderboard -H 'X-Player-Id: p1'
```

## Known limits

- Auth is fake: the `X-Player-Id` header is trusted as-is.
- Disputed matches stay disputed (no resolution flow), and a winner with no league row in the match's week gets the result recorded but no points. A match ID reused by a different pair returns 201 `recorded` but adds no points (the first result stands); a changed resend by the same player returns 200 `duplicate` and the first report stands.
- One Postgres instance, no replica or backups. Each app process has an in-memory leaderboard cache (2 s TTL, dropped when a win is recorded in that process; `LEADERBOARD_CACHE_MS=0` turns it off). With more than one process, other processes stay up to 2 s stale. Expired boards stay in memory until the week changes, so cache memory grows with the leagues read (unmeasured).
- A match counts in the week of its **first** report (migration 003 stores each report's week; older rows use their `created_at` UTC ISO week). The week is the app server's UTC ISO week when that report is processed, not when the match was played. A report on Sunday 23:59:59 confirmed on Monday 00:00:01 adds the point to the old week (test 6). There is no week close yet, so a late confirmation still counts in an old week; production rejects reports for closed weeks (DESIGN.md §5).
- Not in the slice: JWT verification, joining leagues (the seed creates them), week close, payouts, rate limits, shedding, the 14-day report deletion. Reports are deduplicated only while their row exists.
