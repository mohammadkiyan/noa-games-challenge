#!/usr/bin/env bash
# One measured load-test run against the box (make box-up). Usage:
#   make measure PROFILE=smoke|target|knee [LABEL=<label>]  (extra k6 env: TARGET_RPS, HOLD, ...)
# Writes the short, committed summary to evidence/<NN>-<label>.txt and the raw files to
# .runs/<NN>-<label>/ (git-ignored; rerun to reproduce). NN = next free number; never overwrites.
#   k6.txt         k6 stdout (K6_T0_MS marks the scenario start, k6_exit at the end)
#   k6.json        k6 --summary-export
#   samples.csv    every 1 s: box cgroup CPU/throttling/memory (+ memory.max hits), node vs postgres CPU ticks,
#                  pg_stat_activity busy connections and wait types (CONN)
#   app.jsonl      app: pool wait, DB time per endpoint, event loop (5 s windows, raw samples)
#   snapshots.txt  "## <name>" sections: machine, table sizes before/after (C7), pg stats
#                  before/after, pg_stat_statements reset right before k6 (C9), Postgres log lines
#   summary.txt    = evidence/<NN>-<label>.txt (scripts/summarize-run.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE=${PROFILE:?PROFILE=smoke|target|knee}
LABEL=${LABEL:-$PROFILE}
BOX=${BOX_NAME:-hexabout-box}
PG_PORT=${BOX_PG_PORT:-5434}
PG_IMAGE=${PG_IMAGE:-postgres:16}
K6_IMAGE=${K6_IMAGE:-grafana/k6:1.0.0}
BASE_URL=${BASE_URL:-http://localhost:3000}
: "${POSTGRES_USER:=hexabout}" "${POSTGRES_PASSWORD:=change-me}" "${POSTGRES_DB:=hexabout}"

last=$(ls evidence .runs 2>/dev/null | sed -n 's/^\([0-9]\+\)-.*/\1/p' | sort -n | tail -1)
n=$(printf '%02d' $(( 10#${last:--1} + 1 )))
D=".runs/$n-$LABEL"
OUT="evidence/$n-$LABEL.txt"
[ -e "$D" ] || [ -e "$OUT" ] && { echo "refusing to overwrite $D / $OUT" >&2; exit 1; }
curl -sf "$BASE_URL/healthz" >/dev/null || { echo "box is not up ($BASE_URL); run make box-up" >&2; exit 1; }
mkdir -p "$D"
SNAP="$D/snapshots.txt"

PSQL_ARGS=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB")
psql_box() { docker run --rm -i --network host -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_IMAGE" "${PSQL_ARGS[@]}" "$@"; }
now() { date -u +%FT%T.%3NZ; }
section() { echo; echo "## $1"; }

echo "run $n ($PROFILE) -> $OUT (raw: $D/)"

# --- machine ---------------------------------------------------------------
{
  echo "## machine"
  echo "date_utc=$(now) git=$(git rev-parse --short HEAD 2>/dev/null || echo none) dirty_files=$(git status --porcelain 2>/dev/null | wc -l)"
  echo "profile=$PROFILE k6_env: TARGET_RPS=${TARGET_RPS:-} RAMP=${RAMP:-} HOLD=${HOLD:-} KNEE_START=${KNEE_START:-} KNEE_STEP=${KNEE_STEP:-} KNEE_MAX_STEPS=${KNEE_MAX_STEPS:-} KNEE_WARMUP=${KNEE_WARMUP:-} STEP_SECONDS=${STEP_SECONDS:-} LABEL=$LABEL"
  lscpu | grep -E '^(Model name|CPU\(s\)|Thread\(s\) per core|Core\(s\) per socket|CPU max MHz|CPU min MHz)'
  echo "mem_total_bytes=$(free -b | awk '/^Mem:/{print $2}')"
  echo "os=$(. /etc/os-release && echo "$PRETTY_NAME") kernel=$(uname -r) loadavg=$(cut -d' ' -f1-3 /proc/loadavg)"
  echo "docker=$(docker version --format '{{.Server.Version}}') k6_image=$K6_IMAGE k6_cpuset=${K6_CPUSET:-}"
  echo "other_running_containers=$(docker ps --format '{{.Names}}' | grep -vx "$BOX" | tr '\n' ' ')"
  docker inspect "$BOX" --format 'box: image={{.Image}} nano_cpus={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}} memory_swap={{.HostConfig.MemorySwap}} cpuset={{.HostConfig.CpusetCpus}}'
  echo "node=$(docker exec "$BOX" node --version) app_pool_size=$(docker exec "$BOX" printenv PG_POOL_SIZE) leaderboard_cache_ms=$(docker exec "$BOX" printenv LEADERBOARD_CACHE_MS || echo 2000)"
  psql_box -At -c "SELECT version()"
  psql_box -At -F= -c "SELECT name, setting || coalesce(' ' || unit, '') FROM pg_settings WHERE name IN
    ('shared_buffers','max_connections','effective_cache_size','work_mem','maintenance_work_mem','random_page_cost',
     'synchronous_commit','fsync','wal_level','max_wal_size','shared_preload_libraries','track_io_timing') ORDER BY 1"
} > "$SNAP" 2>&1

# --- snapshots -------------------------------------------------------------
SIZES_SQL="WITH c AS (
  SELECT 'league_members'::text AS t, count(*) AS n FROM league_members UNION ALL
  SELECT 'match_reports', count(*) FROM match_reports UNION ALL
  SELECT 'match_results', count(*) FROM match_results)
SELECT t AS table_name, n AS row_count,
       pg_relation_size(t::regclass) AS heap_bytes,
       pg_indexes_size(t::regclass) AS index_bytes,
       pg_total_relation_size(t::regclass) AS total_bytes,
       round(pg_relation_size(t::regclass)::numeric / nullif(n, 0), 1) AS heap_bytes_per_row,
       round(pg_indexes_size(t::regclass)::numeric / nullif(n, 0), 1) AS index_bytes_per_row,
       round(pg_total_relation_size(t::regclass)::numeric / nullif(n, 0), 1) AS total_bytes_per_row
  FROM c
UNION ALL
SELECT 'DATABASE', NULL, NULL, NULL, pg_database_size(current_database()), NULL, NULL, NULL"
PGSTAT_SQL="SELECT now() AS at, xact_commit, xact_rollback, blks_read, blks_hit, tup_inserted, tup_updated,
       deadlocks, temp_bytes, blk_read_time, blk_write_time FROM pg_stat_database WHERE datname = current_database();
SELECT * FROM pg_stat_bgwriter;
SELECT * FROM pg_stat_wal;"
CG=/sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' "$BOX").scope
snapshot() { # $1 = before|after
  { section "sizes_$1"; psql_box --csv -c "$SIZES_SQL"; section "pgstat_$1"; psql_box -x -c "$PGSTAT_SQL"
    section "memevents_$1"; cat "$CG/memory.events"; } >> "$SNAP" # oom_kill = processes killed for memory
}
snapshot before

# --- sampler: one row per second, outside the box's CPU limit (except its 1 backend) ---
ACT_SQL="SELECT count(*) FILTER (WHERE state = 'active'),
  count(*) FILTER (WHERE state = 'active' AND wait_event_type IS NULL),
  count(*) FILTER (WHERE state = 'active' AND wait_event_type = 'Lock'),
  count(*) FILTER (WHERE state = 'active' AND wait_event_type = 'LWLock'),
  count(*) FILTER (WHERE state = 'active' AND wait_event_type = 'IO'),
  count(*) FILTER (WHERE state = 'active' AND wait_event_type NOT IN ('Lock', 'LWLock', 'IO')),
  count(*) FILTER (WHERE state = 'idle in transaction'),
  count(*),
  coalesce(string_agg(wait_event_type || ':' || wait_event, ' ') FILTER (WHERE state = 'active' AND wait_event IS NOT NULL), '')
FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid();"
SAMPLER="$BOX-sampler-$n"
(
  coproc PSQL { docker run --rm -i --name "$SAMPLER" --network host -e PGPASSWORD="$POSTGRES_PASSWORD" "$PG_IMAGE" \
    "${PSQL_ARGS[@]}" -At -F, 2>/dev/null; }
  echo "ts,cpu_usage_usec,cpu_throttled_usec,nr_throttled,nr_periods,mem_current,mem_anon,mem_file,mem_max_events,node_ticks,postgres_ticks,other_ticks,postgres_procs,active,active_running,active_lock,active_lwlock,active_io,active_other,idle_in_tx,client_backends,wait_events"
  while :; do
    ts=$(now)
    printf '%s\n' "$ACT_SQL" >&"${PSQL[1]}"
    cpu=$(awk '$1=="usage_usec"{u=$2} $1=="throttled_usec"{t=$2} $1=="nr_throttled"{n=$2} $1=="nr_periods"{p=$2} END{print u","t","n","p}' "$CG/cpu.stat")
    mem=$(awk '$1=="anon"{a=$2} $1=="file"{f=$2} END{print a","f}' "$CG/memory.stat")
    mem="$mem,$(awk '$1=="max"{print $2}' "$CG/memory.events")" # times the cgroup hit memory.max
    ticks=$(sed 's#.*#/proc/&/stat#' "$CG/cgroup.procs" | xargs cat 2>/dev/null | awk '
      { c=$0; sub(/^[0-9]+ \(/, "", c); sub(/\).*/, "", c); r=$0; sub(/^.*\) /, "", r); split(r, f, " ");
        t=f[12]+f[13]; if (c=="node") nd+=t; else if (c=="postgres") { pg+=t; np++ } else ot+=t }
      END { printf "%d,%d,%d,%d", nd, pg, ot, np }')
    IFS= read -r -t 2 act <&"${PSQL[0]}" || act=",,,,,,,,"
    echo "$ts,$cpu,$(cat "$CG/memory.current"),$mem,$ticks,$act"
    sleep 1
  done
) > "$D/samples.csv" &
sampler_pid=$!
stop_sampler() {
  kill "$sampler_pid" 2>/dev/null || true
  docker stop -t 1 "$SAMPLER" >/dev/null 2>&1 || true
  wait 2>/dev/null || true
}
trap stop_sampler EXIT

# --- run -------------------------------------------------------------------
sleep 5 # sampler settles; idle baseline in the time series
psql_box -c "SELECT pg_stat_statements_reset()" >/dev/null
t_start=$(date -u +%FT%TZ)
set +e
docker run --rm -i --network host --user "$(id -u):$(id -g)" ${K6_CPUSET:+--cpuset-cpus=$K6_CPUSET} \
  -e PROFILE="$PROFILE" -e BASE_URL="$BASE_URL" -e PLAYERS="${PLAYERS:-60000}" \
  $(for v in TARGET_RPS RAMP HOLD KNEE_START KNEE_STEP STEP_SECONDS KNEE_MAX_STEPS KNEE_WARMUP PREALLOC_VUS MAX_VUS; do
      [ -n "${!v:-}" ] && printf -- '-e %s=%s ' "$v" "${!v}"; done) \
  -v "$PWD/slice/loadtest:/loadtest:ro" -v "$PWD/$D:/out" \
  "$K6_IMAGE" run --summary-export /out/k6.json /loadtest/scenario.js > "$D/k6.txt" 2>&1
k6_exit=$?
set -e
echo "k6_exit=$k6_exit" >> "$D/k6.txt"
sleep 6 # let the last 5 s app-metrics window flush
stop_sampler
trap - EXIT

# --- after -----------------------------------------------------------------
{
  section pgss
  psql_box --csv -c "SELECT calls, round(total_exec_time::numeric, 3) AS total_ms, round(mean_exec_time::numeric, 4) AS mean_ms,
      round(stddev_exec_time::numeric, 4) AS stddev_ms, round(max_exec_time::numeric, 3) AS max_ms, rows,
      shared_blks_hit, shared_blks_read, round(blk_read_time::numeric, 3) AS blk_read_ms, wal_bytes,
      left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
    FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY total_exec_time DESC LIMIT 30"
  # Report: one statement per request since migration 002. Leaderboard: one statement per
  # cache miss (WITH me AS = by player, SELECT lm.league_id = by league); hits run no SQL.
  section pgss_endpoint
  psql_box --csv -c "WITH s AS (
      SELECT regexp_replace(query, '\s+', ' ', 'g') AS q, calls, total_exec_time, max_exec_time FROM pg_stat_statements
       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()))
    SELECT CASE WHEN q LIKE 'SELECT report_match(%' THEN 'report' ELSE 'leaderboard' END AS endpoint,
           sum(calls) AS calls,
           round(sum(total_exec_time)::numeric, 3) AS total_ms,
           round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 4) AS mean_ms_per_call,
           round(max(max_exec_time)::numeric, 3) AS max_single_statement_ms
      FROM s WHERE q LIKE 'WITH me AS%' OR q LIKE 'SELECT lm.league_id%' OR q LIKE 'SELECT report_match(%' GROUP BY 1 ORDER BY 1"
} >> "$SNAP"
snapshot after
{
  section pg_log
  docker logs --since "$t_start" "$BOX" 2>&1 | grep -E 'checkpoint|still waiting|deadlock|ERROR|FATAL|PANIC|out of memory' || true
  docker logs --since "$t_start" "$BOX" 2>/dev/null | grep -E '"level":(50|60)' | head -100 || true
} >> "$SNAP"
docker logs --since "$t_start" "$BOX" 2>/dev/null | grep '^{"metrics":1' > "$D/app.jsonl" || true

node scripts/summarize-run.mjs "$D" "$PROFILE" > "$D/summary.txt"
cp "$D/summary.txt" "$OUT"
cat "$OUT"
