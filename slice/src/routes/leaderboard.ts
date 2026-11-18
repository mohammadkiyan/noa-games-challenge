import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { requirePlayer } from '../auth.ts';
import { currentWeekId } from '../db.ts';
import { recordCacheHit, withClient } from '../metrics.ts';

const TOP_N = 50;

// Ranking order. player_id breaks exact ties so the order is deterministic.
// league_board_idx (league_id, points DESC, last_win_at ASC NULLS LAST, player_id) returns
// rows already in this order.
const RANK = 'row_number() OVER (ORDER BY lm.points DESC, lm.last_win_at ASC NULLS LAST, lm.player_id)';

// Whole league of the caller, one round trip: `me` finds the league via the PK.
const BY_PLAYER = `
WITH me AS (
  SELECT league_id FROM league_members WHERE week_id = $1 AND player_id = $2
)
SELECT lm.league_id, lm.player_id, lm.points, ${RANK}::int AS rank
  FROM league_members lm JOIN me ON lm.league_id = me.league_id
 WHERE lm.week_id = $1
 ORDER BY rank`;

// Whole league by id (league ids are unique per week).
const BY_LEAGUE = `
SELECT lm.league_id, lm.player_id, lm.points, ${RANK}::int AS rank
  FROM league_members lm
 WHERE lm.week_id = $1 AND lm.league_id = $2
 ORDER BY rank`;

type Row = { league_id: number; player_id: string; points: number; rank: number };

/**
 * In-process leaderboard cache (DESIGN.md: per league, 2 s TTL, dropped when a result in that
 * league is recorded; valid only with one app instance). LEADERBOARD_CACHE_MS=0 turns it off.
 *
 * - leagueOf: player -> league for the current week. League membership is fixed for the week,
 *   and every league load fills it for all members, so a board can only be cached if its
 *   members are in this map. That is what lets invalidate(winner) find the right board.
 * - boards: league -> the league's ranked rows. The entry is stored before its query finishes,
 *   so concurrent misses share one query, and an invalidation during the query is not undone
 *   when it completes.
 */
export class LeaderboardCache {
  private week = 0;
  private leagueOf = new Map<string, number>();
  private boards = new Map<number, { at: number; rows: Promise<Row[]> }>();

  readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  private roll(week: number): void {
    if (week === this.week) return;
    this.week = week;
    this.leagueOf.clear();
    this.boards.clear();
  }

  async get(pool: pg.Pool, week: number, player: string): Promise<Row[]> {
    if (this.ttlMs <= 0) return load(pool, BY_PLAYER, [week, player]);
    this.roll(week);
    const league = this.leagueOf.get(player);
    if (league === undefined) {
      // First read by anyone in this league (or a player with no league): learn the members,
      // don't cache the board, since a result may have been recorded while this query ran.
      const rows = await load(pool, BY_PLAYER, [week, player]);
      if (week === this.week) for (const r of rows) this.leagueOf.set(r.player_id, r.league_id);
      return rows;
    }
    const now = Date.now();
    const hit = this.boards.get(league);
    if (hit && now - hit.at < this.ttlMs) {
      recordCacheHit('leaderboard');
      return hit.rows;
    }
    const entry = { at: now, rows: load(pool, BY_LEAGUE, [week, league]) };
    this.boards.set(league, entry);
    entry.rows.catch(() => this.boards.get(league) === entry && this.boards.delete(league));
    return entry.rows;
  }

  /** A result was recorded: the winner's league board is stale. */
  invalidate(winner: string): void {
    const league = this.leagueOf.get(winner);
    if (league !== undefined) this.boards.delete(league);
  }
}

async function load(pool: pg.Pool, sql: string, params: unknown[]): Promise<Row[]> {
  const { rows } = await withClient(pool, 'leaderboard', (c) => c.query<Row>(sql, params));
  return rows;
}

export function leaderboardRoutes(pool: pg.Pool, cache: LeaderboardCache): FastifyPluginAsync {
  return async (app) => {
    app.get('/leagues/me/leaderboard', { preHandler: requirePlayer }, async (req, reply) => {
      const me = req.playerId;
      const rows = await cache.get(pool, currentWeekId(), me);
      const mine = rows.find((r) => r.player_id === me);
      if (!mine) return reply.code(404).send({ error: 'no league for this player this week' });

      return {
        leagueId: mine.league_id,
        top: rows
          .filter((r) => r.rank <= TOP_N)
          .map((r) => ({ rank: r.rank, playerId: r.player_id, points: r.points })),
        me: { rank: mine.rank, points: mine.points },
      };
    });
  };
}
