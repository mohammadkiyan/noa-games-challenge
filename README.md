# Hexabout Leagues: take-home slice

A thin vertical slice of weekly leagues: players report match results and read their league's leaderboard.
Node 22 + TypeScript + Fastify + raw SQL on Postgres 16; design and evidence live in the docs next to this file.

## Run

```sh
make up     # Postgres + app in Docker, migrations applied, small dataset seeded
```

## Test

```sh
make test   # Vitest against a throwaway database, created and dropped per run
```

## Endpoints

Auth is a header: `X-Player-Id: <player id>`.

Report a match result (both players report; points are awarded when the second, agreeing report arrives):

```sh
curl -X POST localhost:3000/matches/m-123/report \
  -H 'X-Player-Id: p1' -H 'Content-Type: application/json' \
  -d '{"opponentId":"p2","winnerId":"p1"}'
# 202 waiting_for_opponent · 201 recorded · 200 duplicate · 409 disputed · 400 bad winner
```

Read my league's leaderboard (top of the league plus my own rank):

```sh
curl localhost:3000/leagues/me/leaderboard -H 'X-Player-Id: p1'
```

## Known limits

- Auth is fake: the `X-Player-Id` header is trusted as-is.
- Disputed matches stay disputed (no resolution flow), and a winner with no league row this week gets the result recorded but no points.
- One Postgres instance, no cache or replicas; the week is one global UTC ISO week.
