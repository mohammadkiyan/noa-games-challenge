// Load-test instrumentation, no dependencies and no endpoint. When started, it prints one
// JSON line per window to stdout:
//   {"metrics":1, "<endpoint>": {n, pool_wait_ms:{...}, db_ms:{...}}, "pool":{...}, "event_loop":{...}}
// pool_wait_ms = time in pool.connect() (waiting for a free connection).
// db_ms        = connect-to-release time: all queries of the request incl. round trips and
//                any event-loop delay while awaiting them. Server-side-only time is in
//                pg_stat_statements.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type pg from 'pg';

type Window = { poolWait: number[]; db: number[]; cacheHits: number };
const windows = new Map<string, Window>();
let enabled = false;
let waitingMax = 0;

function record(endpoint: string, poolWaitMs: number, dbMs: number, cacheHit = false): void {
  if (!enabled) return;
  let w = windows.get(endpoint);
  if (!w) windows.set(endpoint, (w = { poolWait: [], db: [], cacheHits: 0 }));
  w.poolWait.push(poolWaitMs);
  w.db.push(dbMs);
  if (cacheHit) w.cacheHits++;
}

/** A request answered from cache: counted with 0 ms pool wait and 0 ms DB time, so db_ms stays per request. */
export function recordCacheHit(endpoint: string): void {
  record(endpoint, 0, 0, true);
}

/** Checks out a client, runs fn, releases it; records pool wait and DB time for `endpoint`. */
export async function withClient<T>(
  pool: pg.Pool,
  endpoint: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (enabled && pool.waitingCount > waitingMax) waitingMax = pool.waitingCount;
  const t0 = performance.now();
  const client = await pool.connect();
  const t1 = performance.now();
  try {
    return await fn(client);
  } finally {
    client.release();
    record(endpoint, t1 - t0, performance.now() - t1);
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function stats(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean: r3(mean), p50: r3(q(0.5)), p95: r3(q(0.95)), p99: r3(q(0.99)), max: r3(s[s.length - 1]) };
}

/** Starts the periodic metrics log. Returns a stop function. */
export function startMetricsLog(pool: pg.Pool, intervalMs: number): () => void {
  enabled = true;
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  let elu = performance.eventLoopUtilization();

  const timer = setInterval(() => {
    const line: Record<string, unknown> = { metrics: 1, t: new Date().toISOString(), window_ms: intervalMs };
    for (const [endpoint, w] of windows) {
      line[endpoint] = {
        n: w.db.length,
        cache_hits: w.cacheHits,
        pool_wait_ms: stats(w.poolWait),
        db_ms: stats(w.db),
        // raw samples (ms, 1 µs resolution) so exact quantiles can be taken over any time range
        raw: { pool_wait_ms: w.poolWait.map(r3), db_ms: w.db.map(r3) },
      };
    }
    windows.clear();
    line.pool = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, waiting_max: waitingMax };
    waitingMax = 0;
    const ns = 1e6;
    line.event_loop = {
      delay_p50_ms: r3(loop.percentile(50) / ns),
      delay_p99_ms: r3(loop.percentile(99) / ns),
      delay_max_ms: r3(loop.max / ns),
      utilization: r3(performance.eventLoopUtilization(elu).utilization),
    };
    loop.reset();
    elu = performance.eventLoopUtilization();
    process.stdout.write(JSON.stringify(line) + '\n');
  }, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
    loop.disable();
    enabled = false;
  };
}
