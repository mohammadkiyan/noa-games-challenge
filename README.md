# Hexabout Leagues: take-home slice

A thin vertical slice of weekly leagues: report match results and read a leaderboard. Node 22 + TypeScript + Fastify + raw SQL on PostgreSQL 16.

## Reviewer quick start

Prerequisites: Git, GNU Make, Bash, Docker Engine or Docker Desktop with Linux containers and Compose v2; Node.js ≥ 22.18 and npm for tests and the demo. First runs pull images and install dependencies. No external services, secrets, or manual database setup required. Defaults work without a .env file; copy .env.example only to override configuration.

```sh
git clone https://github.com/mohammadkiyan/noa-games-challenge.git
cd noa-games-challenge
make up       # build, start PostgreSQL and app, migrate, seed 500 players
make demo     # check the complete dual-report lifecycle
make verify   # typecheck, integration tests, document caps
make down     # stop containers (keeps the local volume)
```

The app listens on http://localhost:3000; PostgreSQL is published on 5433. Use free ports. For a custom app port, set PORT and BASE_URL consistently (e.g. PORT=3001 BASE_URL=http://localhost:3001).

**Disposable data only:** make up reseeds the demo database, replacing match reports/results and current-week memberships. Never use it against production or shared data. The tests create and drop a separate database.

## Tests

```sh
make test       # one command: install dependencies, start DB, migrate isolated DB, run Vitest
make typecheck
make docs-check
```

The integration suite covers concurrent reports, duplicate safety, disputes, atomic increments, week boundaries, ranking and cache invalidation. GitHub Actions runs these checks and the reviewer startup/demo workflow.

## Manual API walkthrough

Authentication is the intentionally fake X-Player-Id header. With the demo app running, use a fresh match ID each time:

```sh
BASE_URL=http://localhost:3000
MATCH_ID="demo-$(date +%s)-$$"

curl -fsS "$BASE_URL/healthz"
curl -fsS "$BASE_URL/leagues/me/leaderboard" -H 'X-Player-Id: p1'

# First report: 202 waiting_for_opponent; points unchanged.
curl -i -X POST "$BASE_URL/matches/$MATCH_ID/report" \
  -H 'X-Player-Id: p1' -H 'Content-Type: application/json' \
  -d '{"opponentId":"p2","winnerId":"p1"}'

# Second agreeing report: 201 recorded; p1 gains exactly one point.
curl -i -X POST "$BASE_URL/matches/$MATCH_ID/report" \
  -H 'X-Player-Id: p2' -H 'Content-Type: application/json' \
  -d '{"opponentId":"p1","winnerId":"p1"}'

# Retry: 200 duplicate; no extra point.
curl -i -X POST "$BASE_URL/matches/$MATCH_ID/report" \
  -H 'X-Player-Id: p2' -H 'Content-Type: application/json' \
  -d '{"opponentId":"p1","winnerId":"p1"}'

curl -fsS "$BASE_URL/leagues/me/leaderboard" -H 'X-Player-Id: p1'
```

The leaderboard returns the league's top 50 and the caller's rank/points in `me` (404 if no league). Compare `me.points` before and after: +1, regardless of the seeded starting score. `make demo` automatically asserts the statuses and scores with a unique match ID. Run it without concurrent load traffic.

A report is one SQL call (`report_match()`, migrations 002 and 003) under a per-match advisory lock. Points rise only when the match result is first inserted.

## Load testing

Quick reviewer smoke (20 RPS for 30 seconds, with strict status checks), using the normal Compose app:

```sh
make up
make benchmark-smoke
make down
```

The smoke uses the same k6 workload as the historical tests with a separate strict-check wrapper. The default 500-player seed matches the smoke workload; keep SMALL_PLAYERS a positive multiple of 50. This writes demo reports, not benchmark evidence, and is not a capacity measurement.

For the instrumented historical methodology, use a Linux Docker Engine host with Bash, curl, Node.js, standard Linux utilities, cgroup v2 and the systemd Docker cgroup path /sys/fs/cgroup/system.slice/docker-<id>.scope. Docker Desktop/rootless/custom cgroup configurations may not expose that path. See [LOADTEST.md](LOADTEST.md).

```sh
make down                  # normal app and benchmark box both use port 3000
make box-up
make box-seed              # destructive: 60k players and six days of history
make measure PROFILE=target LABEL=reviewer-target
make box-down
```

The target profile ramps to 540 RPS over 30 seconds and holds for two minutes; the knee profile in LOADTEST.md is longer. The original raw evidence is already in .runs/ and summaries in evidence/. A new measured run creates new numbered files; no existing evidence is overwritten. Historical runs predate migration 003; reruns on a different host are not expected to reproduce identical numbers. Set PLAYERS consistently if overriding the benchmark seed.

## Known limits

- Auth is fake: the `X-Player-Id` header is trusted as-is.
- Disputed matches stay disputed (no resolution flow), and a winner with no league row in the match's week gets the result recorded but no points. A match ID reused by a different pair returns 201 `recorded` but adds no points (the first result stands); a changed resend by the same player returns 200 `duplicate` and the first report stands.
- One Postgres instance, no replica or backups. Each app process has an in-memory leaderboard cache (2 s TTL, dropped when a win is recorded in that process; `LEADERBOARD_CACHE_MS=0` turns it off). With more than one process, other processes stay up to 2 s stale. Expired boards stay in memory until the week changes, so cache memory grows with the leagues read (unmeasured).
- A match counts in the week of its **first** report (migration 003 stores each report's week; older rows use their `created_at` UTC ISO week). The week is the app server's UTC ISO week when that report is processed, not when the match was played. A report on Sunday 23:59:59 confirmed on Monday 00:00:01 adds the point to the old week (test 6). There is no week close yet, so a late confirmation still counts in an old week; production rejects reports for closed weeks (DESIGN.md §5).
- Not in the slice: JWT verification, joining leagues (the seed creates them), week close, payouts, rate limits, shedding, the 14-day report deletion. Reports are deduplicated only while their row exists.
