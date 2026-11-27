SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

# Optional local overrides (git-ignored). Defaults below match .env.example.
-include .env
export

POSTGRES_USER     ?= hexabout
POSTGRES_PASSWORD ?= change-me
POSTGRES_HOST_PORT ?= 5433
TEST_ADMIN_DATABASE_URL ?= postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@localhost:$(POSTGRES_HOST_PORT)/postgres
SMALL_PLAYERS ?= 500
BIG_PLAYERS   ?= 60000
BASE_URL      ?= http://localhost:3000
K6_IMAGE      ?= grafana/k6:1.0.0

.PHONY: up down install test seed-big measure id-size docs-check typecheck box-build box-up box-down verify demo benchmark-smoke

# --- "Box": app + Postgres in one container sized like a Hetzner CPX02 (load tests) ---
BOX_NAME    ?= hexabout-box
BOX_IMAGE   ?= hexabout-box:local
BOX_VOLUME  ?= hexabout-box-pgdata
BOX_CPUS    ?= 1
BOX_MEMORY  ?= 1g
BOX_PG_PORT ?= 5434
POSTGRES_DB ?= hexabout

box-build:
	docker build -q -f box/Dockerfile -t $(BOX_IMAGE) .

## Start the box: --cpus=1, 1 GB RAM, no swap. Data persists in the $(BOX_VOLUME) volume.
## Options: BOX_CPUS=2 BOX_MEMORY=4g (CPX22 size), BOX_CPUSET=<cpu> (pin to one core), LEADERBOARD_CACHE_MS=0 (cache off).
box-up: box-build
	@docker container rm -f $(BOX_NAME) >/dev/null 2>&1 || true
	docker run -d --name $(BOX_NAME) \
	  --cpus=$(BOX_CPUS) --memory=$(BOX_MEMORY) --memory-swap=$(BOX_MEMORY) --shm-size=256m \
	  $(if $(BOX_CPUSET),--cpuset-cpus=$(BOX_CPUSET)) $(if $(LEADERBOARD_CACHE_MS),-e LEADERBOARD_CACHE_MS=$(LEADERBOARD_CACHE_MS)) \
	  -e POSTGRES_USER=$(POSTGRES_USER) -e POSTGRES_PASSWORD=$(POSTGRES_PASSWORD) -e POSTGRES_DB=$(POSTGRES_DB) \
	  -p 3000:3000 -p $(BOX_PG_PORT):5432 -v $(BOX_VOLUME):/var/lib/postgresql/data \
  $(if $(BOX_NODE_OPTIONS),-e NODE_OPTIONS='$(BOX_NODE_OPTIONS)') \
	  $(BOX_IMAGE) >/dev/null
	@for i in $$(seq 1 120); do curl -sf $(BASE_URL)/healthz >/dev/null && { echo "box up: $(BASE_URL)"; exit 0; }; sleep 1; done; \
	  docker logs --tail 30 $(BOX_NAME); exit 1

## Seed the end-of-week dataset into the box (destructive; see slice/scripts/seed.ts for params).
box-seed:
	docker exec -e DATABASE_URL=postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@127.0.0.1:5432/$(POSTGRES_DB) \
	  $(foreach v,PLAYERS LEAGUE_SIZE MAX_POINTS HISTORY_DAYS MATCHES_PER_PLAYER_DAY DISPUTED HALF_REPORTED MATCH_ID_FORMAT CHUNK,$(if $($(v)),-e $(v)=$($(v)))) \
	  $(BOX_NAME) gosu app node scripts/seed.ts

box-down:
	docker stop -t 30 $(BOX_NAME) >/dev/null
	docker container rm $(BOX_NAME) >/dev/null

## Start Postgres + app, apply migrations, seed a small dataset.
up:
	docker compose up -d --build --wait
	docker compose exec -T app node src/migrate.ts
	docker compose exec -T -e PLAYERS=$(SMALL_PLAYERS) app node scripts/seed.ts

down:
	docker compose down

install:
	@test -d slice/node_modules || (cd slice && npm ci)

typecheck: install
	cd slice && npm run typecheck

## Run vitest against a throwaway database (created and dropped by test/globalSetup.ts).
test: install
	docker compose up -d --wait db
	cd slice && TEST_ADMIN_DATABASE_URL='$(TEST_ADMIN_DATABASE_URL)' npm test

## Complete reviewer validation (no benchmark or reseeding).
verify: typecheck test docs-check

## Exercise dual reporting, duplicate safety and leaderboard via real HTTP.
demo:
	BASE_URL='$(BASE_URL)' node scripts/demo.mjs

## Quick status-checked smoke against the running Compose app (not historical instrumentation).
benchmark-smoke:
	@id=$(docker compose ps -q app); \
	  test -n "$id" || { echo "Start the demo app with make up first" >&2; exit 1; }; \
	  docker run --rm --network "container:$id" \
	    --mount "type=bind,source=$(CURDIR)/slice/loadtest,target=/loadtest,readonly" \
	    -e PROFILE=smoke -e BASE_URL=http://127.0.0.1:3000 -e PLAYERS=$(SMALL_PLAYERS) \
	    $(K6_IMAGE) run /loadtest/reviewer-smoke.js

## Seed the load-test dataset (replaces the current week's league rows).
seed-big:
	docker compose exec -T -e PLAYERS=$(BIG_PLAYERS) app node scripts/seed.ts

## One measured k6 run against the box: make measure PROFILE=smoke|target|knee [LABEL=...]
## Summary -> evidence/<NN>-<label>.txt, raw -> .runs/<NN>-<label>/, both committed (never overwrites). See scripts/measure.sh.
measure:
	PROFILE=$(PROFILE) LABEL=$(LABEL) ./scripts/measure.sh

## C7 with UUID player ids vs the seeded short ids (temp tables only) -> evidence/id-size.txt
id-size:
	@{ echo "# make id-size  date=$$(date -u +%FT%TZ)  (scripts/id-size.sql)"; \
	  docker exec -i -e PGPASSWORD=$(POSTGRES_PASSWORD) $(BOX_NAME) psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 \
	    -U $(POSTGRES_USER) -d $(POSTGRES_DB) < scripts/id-size.sql; } > evidence/id-size.txt; cat evidence/id-size.txt

## Fail if any doc is over its word cap.
docs-check:
	./scripts/docs-check.sh
