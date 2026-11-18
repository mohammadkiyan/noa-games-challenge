import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    playerId: string;
  }
}

const MAX_ID_LEN = 64;

/** Fake auth: trusts the X-Player-Id header. 401 if missing or malformed. */
export async function requirePlayer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.headers['x-player-id'];
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (id.length === 0 || id.length > MAX_ID_LEN) {
    return reply.code(401).send({ error: 'missing or invalid X-Player-Id header' });
  }
  req.playerId = id;
}
