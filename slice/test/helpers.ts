import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { inject } from 'vitest';
import { createPool, currentWeekId } from '../src/db.ts';
import { buildApp } from '../src/server.ts';

export function setupApp(): { pool: pg.Pool; app: FastifyInstance } {
  const pool = createPool(inject('databaseUrl'));
  return { pool, app: buildApp(pool) };
}

export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE league_members, match_reports, match_results');
}

export async function addMember(
  pool: pg.Pool,
  m: { playerId: string; leagueId: number; points?: number; lastWinAt?: string | null; weekId?: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO league_members (week_id, player_id, league_id, points, last_win_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [m.weekId ?? currentWeekId(), m.playerId, m.leagueId, m.points ?? 0, m.lastWinAt ?? null],
  );
}

export async function pointsOf(pool: pg.Pool, playerId: string): Promise<number> {
  const { rows } = await pool.query<{ points: number }>(
    'SELECT points FROM league_members WHERE week_id = $1 AND player_id = $2',
    [currentWeekId(), playerId],
  );
  return rows[0].points;
}

export async function countRows(pool: pg.Pool, table: 'match_reports' | 'match_results', matchId: string) {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE match_id = $1`, [
    matchId,
  ]);
  return rows[0].n;
}
