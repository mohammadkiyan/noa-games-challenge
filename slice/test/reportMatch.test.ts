import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentWeekId } from '../src/db.ts';
import { addMember, countRows, pointsOf, resetDb, setupApp } from './helpers.ts';

const { pool, app } = setupApp();
afterAll(async () => {
  await app.close();
  await pool.end();
});

let seq = 0;
const newMatchId = () => `m-${Date.now()}-${++seq}`;

function report(reporter: string, matchId: string, opponentId: string, winnerId: string) {
  return app.inject({
    method: 'POST',
    url: `/matches/${matchId}/report`,
    headers: { 'x-player-id': reporter },
    payload: { opponentId, winnerId },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await resetDb(pool);
  for (const id of ['p1', 'p2', 'p3']) await addMember(pool, { playerId: id, leagueId: 1 });
});

describe('POST /matches/:matchId/report', () => {
  it('1. same report sent twice: one row, no extra points', async () => {
    const m = newMatchId();
    const first = await report('p1', m, 'p2', 'p1');
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'waiting_for_opponent' });

    const again = await report('p1', m, 'p2', 'p1');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'duplicate' });
    expect(await countRows(pool, 'match_reports', m)).toBe(1);

    const confirm = await report('p2', m, 'p1', 'p1');
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json()).toEqual({ status: 'recorded' });

    // Retrying either side after the result exists changes nothing.
    expect((await report('p2', m, 'p1', 'p1')).json()).toEqual({ status: 'duplicate' });
    expect((await report('p1', m, 'p2', 'p1')).json()).toEqual({ status: 'duplicate' });
    expect(await countRows(pool, 'match_reports', m)).toBe(2);
    expect(await countRows(pool, 'match_results', m)).toBe(1);
    expect(await pointsOf(pool, 'p1')).toBe(1);
    expect(await pointsOf(pool, 'p2')).toBe(0);
  });

  it('2. two agreeing reports in parallel (x50): exactly one result and +1 per match', async () => {
    const ROUNDS = 50;
    for (let i = 0; i < ROUNDS; i++) {
      const m = newMatchId();
      const [a, b] = await Promise.all([report('p1', m, 'p2', 'p1'), report('p2', m, 'p1', 'p1')]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 202]);
      expect(await countRows(pool, 'match_results', m)).toBe(1);
    }
    expect(await pointsOf(pool, 'p1')).toBe(ROUNDS);
    expect(await pointsOf(pool, 'p2')).toBe(0);
  });

  it('3. two disagreeing reports: 409, no result, 0 points', async () => {
    const m = newMatchId();
    expect((await report('p1', m, 'p2', 'p1')).statusCode).toBe(202);
    const second = await report('p2', m, 'p1', 'p2');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ status: 'disputed' });
    expect(await countRows(pool, 'match_results', m)).toBe(0);
    expect(await pointsOf(pool, 'p1')).toBe(0);
    expect(await pointsOf(pool, 'p2')).toBe(0);
  });

  it('3b. reports that name different opponents count as a dispute', async () => {
    const m = newMatchId();
    expect((await report('p1', m, 'p2', 'p1')).statusCode).toBe(202);
    const third = await report('p3', m, 'p1', 'p1'); // p1 said they played p2, not p3
    expect(third.statusCode).toBe(409);
    expect(await countRows(pool, 'match_results', m)).toBe(0);
    expect(await pointsOf(pool, 'p1')).toBe(0);
  });

  it('4. winner who is not in the match: 400, nothing stored', async () => {
    const m = newMatchId();
    const res = await report('p1', m, 'p2', 'p3');
    expect(res.statusCode).toBe(400);
    expect(await countRows(pool, 'match_reports', m)).toBe(0);
  });

  it('4b. playing yourself: 400', async () => {
    expect((await report('p1', newMatchId(), 'p1', 'p1')).statusCode).toBe(400);
  });

  it('4c. missing X-Player-Id: 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/matches/${newMatchId()}/report`,
      payload: { opponentId: 'p2', winnerId: 'p2' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('5. same player wins two different matches in parallel: +2, not +1 (atomic increment)', async () => {
    const ROUNDS = 20;
    for (let i = 0; i < ROUNDS; i++) {
      const a = newMatchId();
      const b = newMatchId();
      expect((await report('p1', a, 'p2', 'p1')).statusCode).toBe(202);
      expect((await report('p1', b, 'p3', 'p1')).statusCode).toBe(202);
      const [ra, rb] = await Promise.all([report('p2', a, 'p1', 'p1'), report('p3', b, 'p1', 'p1')]);
      expect([ra.statusCode, rb.statusCode]).toEqual([201, 201]);
    }
    expect(await pointsOf(pool, 'p1')).toBe(2 * ROUNDS);
  });

  describe('week boundary: a match counts in the week of its first report', () => {
    // ISO weeks 2020-01 (ends Sunday 2020-01-05) and 2020-02; neither is the real current week.
    const SUNDAY = new Date('2020-01-05T23:59:59Z');
    const MONDAY = new Date('2020-01-06T00:00:01Z');
    const OLD = currentWeekId(SUNDAY);
    const NEW = currentWeekId(MONDAY);

    const pointsIn = async (week: number, player: string) =>
      (
        await pool.query<{ points: number }>(
          'SELECT points FROM league_members WHERE week_id = $1 AND player_id = $2',
          [week, player],
        )
      ).rows[0].points;
    const resultWeek = async (matchId: string) =>
      (await pool.query<{ week_id: number }>('SELECT week_id FROM match_results WHERE match_id = $1', [matchId]))
        .rows[0].week_id;

    beforeEach(async () => {
      expect([OLD, NEW]).toEqual([202001, 202002]);
      for (const weekId of [OLD, NEW]) {
        for (const playerId of ['p1', 'p2']) await addMember(pool, { playerId, leagueId: 7, weekId });
      }
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    it('6. reported Sunday 23:59:59, confirmed Monday 00:00:01: +1 in the old week only; retries add nothing', async () => {
      const m = newMatchId();
      vi.setSystemTime(SUNDAY);
      expect((await report('p1', m, 'p2', 'p1')).statusCode).toBe(202);

      vi.setSystemTime(MONDAY);
      expect((await report('p2', m, 'p1', 'p1')).statusCode).toBe(201);
      expect((await report('p1', m, 'p2', 'p1')).json()).toEqual({ status: 'duplicate' });
      expect((await report('p2', m, 'p1', 'p1')).json()).toEqual({ status: 'duplicate' });

      expect(await resultWeek(m)).toBe(OLD);
      expect(await pointsIn(OLD, 'p1')).toBe(1);
      expect(await pointsIn(NEW, 'p1')).toBe(0);
      expect(await countRows(pool, 'match_results', m)).toBe(1);
    });

    it('6b. first report stored before migration 003 (no week_id): week taken from its created_at', async () => {
      const m = newMatchId();
      await pool.query(
        `INSERT INTO match_reports (match_id, reporter_id, opponent_id, winner_id, created_at)
         VALUES ($1, 'p1', 'p2', 'p1', $2)`,
        [m, SUNDAY.toISOString()],
      );
      vi.setSystemTime(MONDAY);
      expect((await report('p2', m, 'p1', 'p1')).statusCode).toBe(201);
      expect(await resultWeek(m)).toBe(OLD);
      expect(await pointsIn(OLD, 'p1')).toBe(1);
      expect(await pointsIn(NEW, 'p1')).toBe(0);
    });
  });
});
