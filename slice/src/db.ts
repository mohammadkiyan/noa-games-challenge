import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_SIZE ?? 10),
  });
}

/** ISO-8601 week of `now` in UTC, as yyyyww (e.g. 202647). One global weekly reset. */
export function currentWeekId(now = new Date()): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thursday of this ISO week decides the year
  const isoYear = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return isoYear * 100 + week;
}
