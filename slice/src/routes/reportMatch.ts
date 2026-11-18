import type { FastifyPluginAsync } from 'fastify';
import type pg from 'pg';
import { requirePlayer } from '../auth.ts';
import { currentWeekId } from '../db.ts';
import { withClient } from '../metrics.ts';
import type { LeaderboardCache } from './leaderboard.ts';

const WIN_POINTS = 1;

const schema = {
  params: {
    type: 'object',
    required: ['matchId'],
    properties: { matchId: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  body: {
    type: 'object',
    required: ['opponentId', 'winnerId'],
    properties: {
      opponentId: { type: 'string', minLength: 1, maxLength: 64 },
      winnerId: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
} as const;

type Status = 'duplicate' | 'waiting_for_opponent' | 'disputed' | 'recorded';
const HTTP_CODE: Record<Status, number> = { duplicate: 200, waiting_for_opponent: 202, disputed: 409, recorded: 201 };

type Req = { Params: { matchId: string }; Body: { opponentId: string; winnerId: string } };

/**
 * Both players report the same match. Points are awarded once, when the second agreeing
 * report arrives. The decision runs inside report_match() (migrations/002_report_match_fn.sql)
 * as one statement, so one round trip per report. It takes a per-match advisory lock first:
 * under READ COMMITTED, two concurrent reports would otherwise each miss the other's
 * uncommitted insert and neither would record the result.
 */
export function reportMatchRoutes(pool: pg.Pool, cache: LeaderboardCache): FastifyPluginAsync {
  return async (app) => {
    app.post<Req>('/matches/:matchId/report', { schema, preHandler: requirePlayer }, async (req, reply) => {
      const me = req.playerId;
      const { matchId } = req.params;
      const { opponentId, winnerId } = req.body;

      if (opponentId === me) return reply.code(400).send({ error: 'opponentId must differ from the caller' });
      if (winnerId !== me && winnerId !== opponentId) {
        return reply.code(400).send({ error: 'winnerId must be the caller or opponentId' });
      }

      const { rows } = await withClient(pool, 'report', (c) =>
        c.query<{ status: Status }>('SELECT report_match($1, $2, $3, $4, $5, $6) AS status', [
          matchId,
          me,
          opponentId,
          winnerId,
          currentWeekId(),
          WIN_POINTS,
        ]),
      );
      const status = rows[0].status;
      // Only the winner's points can have changed. Dropping a board twice is harmless.
      if (status === 'recorded') cache.invalidate(winnerId);
      return reply.code(HTTP_CODE[status]).send({ status });
    });
  };
}
