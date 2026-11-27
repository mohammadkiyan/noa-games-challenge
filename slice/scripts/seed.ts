// Seeds an end-of-week dataset for load tests. Env parameters (defaults):
//   PLAYERS=60000            players p1..pN, current week, league floor((i-1)/LEAGUE_SIZE)+1
//   LEAGUE_SIZE=50
//   MAX_POINTS=40            random points 0..MAX_POINTS
//   HISTORY_DAYS=6           days of match history
//   MATCHES_PER_PLAYER_DAY=8 => results = PLAYERS * this * HISTORY_DAYS / 2, reports = 2x results
//   DISPUTED=3000            matches with two disagreeing reports, no result
//   HALF_REPORTED=3000       matches with one report only, no result
//   MATCH_ID_FORMAT=uuid     uuid (36-char text, as a phone would generate) | short (m<n>)
//   CHUNK=100000             matches per INSERT batch (one transaction each)
// Opponents are random players (matchmaking is not per league). All history rows get the
// current week_id, created_at spread over the last HISTORY_DAYS days.
// DESTRUCTIVE for load-test databases: truncates match_reports/match_results and replaces
// the current week's league_members rows.
import type pg from 'pg';
import { createPool, currentWeekId } from '../src/db.ts';

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const PLAYERS = env('PLAYERS', 60_000);
const LEAGUE_SIZE = env('LEAGUE_SIZE', 50);
const MAX_POINTS = env('MAX_POINTS', 40);
const HISTORY_DAYS = env('HISTORY_DAYS', 6);
const MATCHES_PER_PLAYER_DAY = env('MATCHES_PER_PLAYER_DAY', 8);
const DISPUTED = env('DISPUTED', 3_000);
const HALF_REPORTED = env('HALF_REPORTED', 3_000);
const CHUNK = env('CHUNK', 100_000);
const ID_FORMAT = process.env.MATCH_ID_FORMAT ?? 'uuid';
if (ID_FORMAT !== 'uuid' && ID_FORMAT !== 'short') throw new Error('MATCH_ID_FORMAT must be uuid|short');

const RESULTS = Math.floor((PLAYERS * MATCHES_PER_PLAYER_DAY * HISTORY_DAYS) / 2);

// $1 week, $2 players, $3 first global match index, $4 count, $5 total matches, $6 days
// kind: 'agreed' -> result + 2 agreeing reports; 'disputed' -> 2 disagreeing reports;
//       'half' -> 1 report.
const matchCte = (idExpr: string) => `
WITH m AS MATERIALIZED (
  SELECT ${idExpr} AS match_id, $1::int AS week_id,
         'p' || (1 + a) AS pa,
         'p' || (1 + (a + off) % $2::int) AS pb,
         random() < 0.5 AS a_wins,
         now() - make_interval(days => $6::int) + (g::float8 / $5::float8) * make_interval(days => $6::int) AS at
    FROM (SELECT g, floor(random() * $2::int)::int AS a, 1 + floor(random() * ($2::int - 1))::int AS off
            FROM generate_series($3::int, $3::int + $4::int - 1) g) x
)`;

const idExpr = (prefix: string) => (ID_FORMAT === 'uuid' ? 'gen_random_uuid()::text' : `'${prefix}' || g`);

const SQL = {
  agreed: `${matchCte(idExpr('m'))},
  res AS (
    INSERT INTO match_results (match_id, week_id, winner_id, loser_id, created_at)
    SELECT match_id, week_id, CASE WHEN a_wins THEN pa ELSE pb END, CASE WHEN a_wins THEN pb ELSE pa END,
           at + interval '20 seconds'
      FROM m
  )
  INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id, created_at, week_id)
  SELECT match_id, r.reporter, r.opponent, CASE WHEN a_wins THEN pa ELSE pb END, r.at, week_id
    FROM m CROSS JOIN LATERAL (VALUES (pa, pb, at), (pb, pa, at + interval '20 seconds')) r(reporter, opponent, at)`,
  disputed: `${matchCte(idExpr('d'))}
  INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id, created_at, week_id)
  SELECT match_id, r.reporter, r.opponent, r.reporter, r.at, week_id   -- each claims the win
    FROM m CROSS JOIN LATERAL (VALUES (pa, pb, at), (pb, pa, at + interval '20 seconds')) r(reporter, opponent, at)`,
  half: `${matchCte(idExpr('h'))}
  INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id, created_at, week_id)
  SELECT match_id, pa, pb, CASE WHEN a_wins THEN pa ELSE pb END, at, week_id FROM m`,
};

async function inChunks(pool: pg.Pool, kind: keyof typeof SQL, total: number, weekId: number) {
  const t0 = Date.now();
  for (let from = 1; from <= total; from += CHUNK) {
    const n = Math.min(CHUNK, total - from + 1);
    await pool.query(SQL[kind], [weekId, PLAYERS, from, n, total, HISTORY_DAYS]);
  }
  console.log(`  ${kind}: ${total} matches in ${Date.now() - t0} ms`);
}

function startOfIsoWeekUtc(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return midnight - ((now.getUTCDay() + 6) % 7) * 86_400_000;
}

async function seedMembers(pool: pg.Pool, weekId: number) {
  const now = Date.now();
  const weekStart = startOfIsoWeekUtc(new Date(now));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM league_members WHERE week_id = $1', [weekId]);
    for (let from = 1; from <= PLAYERS; from += 10_000) {
      const to = Math.min(from + 9_999, PLAYERS);
      const ids: string[] = [];
      const leagues: number[] = [];
      const points: number[] = [];
      const lastWin: (string | null)[] = [];
      for (let i = from; i <= to; i++) {
        const p = Math.floor(Math.random() * (MAX_POINTS + 1));
        ids.push(`p${i}`);
        leagues.push(Math.floor((i - 1) / LEAGUE_SIZE) + 1);
        points.push(p);
        lastWin.push(p > 0 ? new Date(weekStart + Math.random() * (now - weekStart)).toISOString() : null);
      }
      await client.query(
        `INSERT INTO league_members (week_id, player_id, league_id, points, last_win_at)
         SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[], $5::timestamptz[])`,
        [weekId, ids, leagues, points, lastWin],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const t0 = Date.now();
  const pool = createPool();
  const weekId = currentWeekId();
  try {
    console.log(
      `seed: players=${PLAYERS} league_size=${LEAGUE_SIZE} days=${HISTORY_DAYS} ` +
        `matches/player/day=${MATCHES_PER_PLAYER_DAY} disputed=${DISPUTED} half=${HALF_REPORTED} ` +
        `id_format=${ID_FORMAT} week=${weekId}`,
    );
    await seedMembers(pool, weekId);
    console.log(`  league_members: ${PLAYERS} rows in ${Math.ceil(PLAYERS / LEAGUE_SIZE)} leagues`);
    await pool.query('TRUNCATE match_reports, match_results');
    await inChunks(pool, 'agreed', RESULTS, weekId);
    await inChunks(pool, 'disputed', DISPUTED, weekId);
    await inChunks(pool, 'half', HALF_REPORTED, weekId);

    const tv = Date.now();
    await pool.query('VACUUM ANALYZE league_members, match_reports, match_results');
    console.log(`  VACUUM ANALYZE in ${Date.now() - tv} ms`);

    const { rows } = await pool.query<{ t: string; n: string }>(
      `SELECT 'league_members' t, count(*) n FROM league_members
       UNION ALL SELECT 'match_reports', count(*) FROM match_reports
       UNION ALL SELECT 'match_results', count(*) FROM match_results`,
    );
    for (const r of rows) console.log(`  count ${r.t} = ${r.n}`);
    const size = await pool.query<{ s: string; b: string }>(
      'SELECT pg_size_pretty(pg_database_size(current_database())) s, pg_database_size(current_database()) b',
    );
    console.log(`  database size = ${size.rows[0].s} (${size.rows[0].b} bytes)`);
    console.log(`seed done in ${Date.now() - t0} ms`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
