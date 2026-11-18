import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from './db.ts';
import { startMetricsLog } from './metrics.ts';
import { reportMatchRoutes } from './routes/reportMatch.ts';
import { LeaderboardCache, leaderboardRoutes } from './routes/leaderboard.ts';

export function buildApp(pool: pg.Pool, opts: { logger?: boolean; cacheMs?: number } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  // Leaderboard cache TTL; LEADERBOARD_CACHE_MS=0 turns it off.
  const cache = new LeaderboardCache(opts.cacheMs ?? Number(process.env.LEADERBOARD_CACHE_MS ?? 2000));

  app.get('/healthz', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.register(reportMatchRoutes(pool, cache));
  app.register(leaderboardRoutes(pool, cache));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  const app = buildApp(pool, { logger: true });
  const port = Number(process.env.PORT ?? 3000);
  // Load-test instrumentation: one JSON line per window. METRICS_INTERVAL_MS=0 turns it off.
  const metricsMs = Number(process.env.METRICS_INTERVAL_MS ?? 5000);
  const stopMetrics = metricsMs > 0 ? startMetricsLog(pool, metricsMs) : () => {};

  const shutdown = async () => {
    stopMetrics();
    await app.close();
    await pool.end();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  app.listen({ port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
