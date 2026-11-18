#!/usr/bin/env bash
# Starts Postgres and the app side by side in one container; if either exits, stop both.
set -euo pipefail

: "${POSTGRES_USER:?}" "${POSTGRES_PASSWORD:?}" "${POSTGRES_DB:?}"
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"

# Official image entrypoint: initdb on first start (incl. /docker-entrypoint-initdb.d), then
# drops to the postgres user and execs the server, so $pg_pid ends up being the postmaster.
docker-entrypoint.sh postgres -c config_file=/etc/postgresql/box.conf &
pg_pid=$!

# During first init a temporary server listens on the unix socket only; wait for TCP.
until pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  kill -0 "$pg_pid" 2>/dev/null || { echo "postgres exited during startup" >&2; exit 1; }
  sleep 0.5
done

gosu app node src/migrate.ts
gosu app node src/server.ts &
app_pid=$!

stop() {
  kill -TERM "$app_pid" 2>/dev/null || true
  kill -INT "$pg_pid" 2>/dev/null || true   # fast shutdown
  wait || true
}
trap stop TERM INT

set +e
wait -n "$pg_pid" "$app_pid"
code=$?
echo "a box process exited (code $code); stopping the other" >&2
stop
exit "$code"
