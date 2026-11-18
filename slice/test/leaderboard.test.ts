import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { currentWeekId } from '../src/db.ts';
import { addMember, resetDb, setupApp } from './helpers.ts';

const report = (matchId: string, me: string, opponentId: string, winnerId: string) =>
  app.inject({
    method: 'POST',
    url: `/matches/${matchId}/report`,
    headers: { 'x-player-id': me },
    payload: { opponentId, winnerId },
  });

const { pool, app } = setupApp();
afterAll(async () => {
  await app.close();
  await pool.end();
});

const get = (playerId?: string) =>
  app.inject({
    method: 'GET',
    url: '/leagues/me/leaderboard',
    headers: playerId ? { 'x-player-id': playerId } : {},
  });

type Board = {
  leagueId: number;
  top: { rank: number; playerId: string; points: number }[];
  me: { rank: number; points: number };
};

beforeEach(() => resetDb(pool));

describe('GET /leagues/me/leaderboard', () => {
  it('orders by points desc, then earliest last win; ties are deterministic', async () => {
    await addMember(pool, { playerId: 'a', leagueId: 7, points: 5, lastWinAt: '2026-01-01T10:00:00Z' });
    await addMember(pool, { playerId: 'b', leagueId: 7, points: 9, lastWinAt: '2026-01-01T12:00:00Z' });
    await addMember(pool, { playerId: 'c', leagueId: 7, points: 5, lastWinAt: '2026-01-01T09:00:00Z' }); // reached 5 first
    await addMember(pool, { playerId: 'd', leagueId: 7, points: 0, lastWinAt: null });
    await addMember(pool, { playerId: 'e', leagueId: 7, points: 0, lastWinAt: null });
    await addMember(pool, { playerId: 'x', leagueId: 8, points: 99 }); // other league, must not appear

    const res = await get('a');
    expect(res.statusCode).toBe(200);
    const body = res.json<Board>();
    expect(body.leagueId).toBe(7);
    expect(body.top).toEqual([
      { rank: 1, playerId: 'b', points: 9 },
      { rank: 2, playerId: 'c', points: 5 },
      { rank: 3, playerId: 'a', points: 5 },
      { rank: 4, playerId: 'd', points: 0 },
      { rank: 5, playerId: 'e', points: 0 },
    ]);
    expect(body.me).toEqual({ rank: 3, points: 5 });
  });

  it('returns only the top 50 but still reports my rank when I am below it', async () => {
    for (let i = 1; i <= 55; i++) {
      await addMember(pool, { playerId: `q${i}`, leagueId: 3, points: 100 - i, lastWinAt: '2026-01-01T00:00:00Z' });
    }
    const body = (await get('q53')).json<Board>();
    expect(body.top).toHaveLength(50);
    expect(body.top[0]).toEqual({ rank: 1, playerId: 'q1', points: 99 });
    expect(body.top[49].rank).toBe(50);
    expect(body.me).toEqual({ rank: 53, points: 47 });
  });

  it('404 for a player with no league this week', async () => {
    await addMember(pool, { playerId: 'old', leagueId: 1, points: 3, weekId: currentWeekId() - 1 });
    expect((await get('nobody')).statusCode).toBe(404);
    expect((await get('old')).statusCode).toBe(404);
  });

  it('401 without X-Player-Id', async () => {
    expect((await get()).statusCode).toBe(401);
  });

  it('cache (2 s): serves a cached board, and a recorded win drops it at once', async () => {
    await addMember(pool, { playerId: 'w', leagueId: 11, points: 1 });
    await addMember(pool, { playerId: 'l', leagueId: 11, points: 2 });
    await get('w'); // learns league 11's members
    expect((await get('l')).json<Board>().me.points).toBe(2); // caches league 11

    // A change the app doesn't know about is not seen within the TTL: the cache is on.
    await pool.query("UPDATE league_members SET points = 50 WHERE player_id = 'l'");
    expect((await get('w')).json<Board>().top[0]).toEqual({ rank: 1, playerId: 'l', points: 2 });

    // A recorded result drops the winner's league board, so the next read is fresh.
    expect((await report('cache-m1', 'w', 'l', 'w')).statusCode).toBe(202);
    expect((await report('cache-m1', 'l', 'w', 'w')).statusCode).toBe(201);
    const after = (await get('l')).json<Board>();
    expect(after.top.map((r) => [r.playerId, r.points])).toEqual([['l', 50], ['w', 2]]);
  });
});
