// Reviewer demo: run against the disposable, seeded Compose application.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const match = randomUUID();

async function request(path, expected, player, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(player ? { 'X-Player-Id': player } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  assert.equal(response.status, expected, path + ': ' + raw);
  return JSON.parse(raw);
}

async function score() {
  const board = await request('/leagues/me/leaderboard', 200, 'p1');
  assert.ok(Number.isInteger(board.me.points));
  return board.me.points;
}

async function report(player, opponent, code, status) {
  const result = await request('/matches/' + match + '/report', code, player, {
    opponentId: opponent, winnerId: 'p1',
  });
  assert.equal(result.status, status);
  console.log(code + ' ' + status);
}

assert.equal((await request('/healthz', 200)).ok, true);
const before = await score();
await report('p1', 'p2', 202, 'waiting_for_opponent');
assert.equal(await score(), before, 'first report must not award points');
await report('p2', 'p1', 201, 'recorded');
assert.equal(await score(), before + 1, 'confirmation must award one point');
await report('p2', 'p1', 200, 'duplicate');
assert.equal(await score(), before + 1, 'retry must not award another point');
console.log('PASS: p1 points ' + before + ' -> ' + (before + 1) + '; duplicate unchanged.');
