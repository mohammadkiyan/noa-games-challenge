// k6 scenario. Mix by request count: 80% leaderboard reads / 20% match reports
// (per match: 2 reports + 8 reads). Reports are always a pair, both players of one match,
// sent concurrently with http.batch so the per-match advisory lock is exercised. 2% of pairs
// re-send one report afterwards (~1% of reports are duplicates, on top of the 20%).
// Open model: arrival-rate executors keep the offered rate fixed when the server slows down.
//
// PROFILE=smoke   20 rps for 30 s                              (tag phase=steady)
// PROFILE=target  ramp 0 -> TARGET_RPS over RAMP, hold HOLD     (tags phase=ramp|steady)
// PROFILE=knee    [KNEE_WARMUP s ramp to KNEE_START, tag step=0], then KNEE_START rps, +KNEE_STEP every
//                 STEP_SECONDS, up to KNEE_MAX_STEPS steps
//                 (tag step=<n>); aborts when a step's p95 > 300 ms or error rate > 1%.
//
// Env: BASE_URL, PROFILE, TARGET_RPS, RAMP, HOLD, KNEE_START, KNEE_STEP, STEP_SECONDS,
//      KNEE_MAX_STEPS, KNEE_WARMUP, PLAYERS (must match the seed), PREALLOC_VUS, MAX_VUS.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const PROFILE = __ENV.PROFILE || 'target';
const PLAYERS = Number(__ENV.PLAYERS || 60000);
const LEAGUE_SIZE = 50;
const READ_SHARE = 0.8;
const DUP_PAIR_PROB = 0.02;
const PREALLOC = Number(__ENV.PREALLOC_VUS || 100);
const MAX_VUS = Number(__ENV.MAX_VUS || 3000);

const TARGET_RPS = Number(__ENV.TARGET_RPS || 540);
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '2m';
const KNEE_START = Number(__ENV.KNEE_START || 100);
const KNEE_STEP = Number(__ENV.KNEE_STEP || 100);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 60);
const KNEE_MAX_STEPS = Number(__ENV.KNEE_MAX_STEPS || 20);
const KNEE_WARMUP = Number(__ENV.KNEE_WARMUP || 0); // s of linear ramp 0 -> KNEE_START before step 1 (tag step=0)

// rps -> iterations/s per scenario. Reads: 1 request/iteration. Pairs: 2 requests/iteration.
const readRate = (rps) => Math.round(rps * READ_SHARE);
const pairRate = (rps) => Math.round((rps * (1 - READ_SHARE)) / 2);

const base = (execName) => ({
  exec: execName,
  timeUnit: '1s',
  preAllocatedVUs: PREALLOC,
  maxVUs: MAX_VUS,
});

function constant(execName, rate, duration, startTime, phase) {
  return { ...base(execName), executor: 'constant-arrival-rate', rate, duration, startTime, tags: { phase } };
}

function kneeStages(rateFn) {
  const stages = KNEE_WARMUP ? [{ target: rateFn(KNEE_START), duration: `${KNEE_WARMUP}s` }] : [];
  for (let k = 1; k <= KNEE_MAX_STEPS; k++) {
    const r = rateFn(KNEE_START + (k - 1) * KNEE_STEP);
    if (k > 1) stages.push({ target: r, duration: '1s' }); // jump
    stages.push({ target: r, duration: `${k > 1 ? STEP_SECONDS - 1 : STEP_SECONDS}s` }); // hold
  }
  return stages;
}

const scenarios = {};
const thresholds = {
  // Report-only thresholds (always pass) so the summary prints these sub-metrics.
  dropped_iterations: ['count>=0'],
  'http_reqs{endpoint:leaderboard}': ['count>=0'],
  'http_reqs{endpoint:report}': ['count>=0'],
};

if (PROFILE === 'smoke' || PROFILE === 'target') {
  const rps = PROFILE === 'smoke' ? 20 : TARGET_RPS;
  if (PROFILE === 'smoke') {
    scenarios.reads_steady = constant('readLeaderboard', readRate(rps), '30s', '0s', 'steady');
    scenarios.reports_steady = constant('reportPair', pairRate(rps), '30s', '0s', 'steady');
  } else {
    for (const [name, fn, rate] of [
      ['reads', 'readLeaderboard', readRate(rps)],
      ['reports', 'reportPair', pairRate(rps)],
    ]) {
      scenarios[`${name}_ramp`] = {
        ...base(fn),
        executor: 'ramping-arrival-rate',
        startRate: 1,
        stages: [{ target: rate, duration: RAMP }],
        tags: { phase: 'ramp' },
      };
      scenarios[`${name}_steady`] = constant(fn, rate, HOLD, RAMP, 'steady');
    }
  }
  Object.assign(thresholds, {
    'http_req_duration{phase:steady}': ['max>=0'],
    'http_req_duration{phase:steady,endpoint:leaderboard}': ['max>=0'],
    'http_req_duration{phase:steady,endpoint:report}': ['max>=0'],
    'http_req_failed{phase:steady}': ['rate>=0'],
    'http_reqs{phase:steady}': ['count>=0'],
  });
} else if (PROFILE === 'knee') {
  scenarios.reads = {
    ...base('readLeaderboard'),
    executor: 'ramping-arrival-rate',
    startRate: KNEE_WARMUP ? 1 : readRate(KNEE_START),
    stages: kneeStages(readRate),
  };
  scenarios.reports = {
    ...base('reportPair'),
    executor: 'ramping-arrival-rate',
    startRate: KNEE_WARMUP ? 1 : pairRate(KNEE_START),
    stages: kneeStages(pairRate),
  };
  for (let k = 1; k <= KNEE_MAX_STEPS; k++) {
    // Evaluate a step only after 10 s of its own data; abort the whole test when it fails.
    const delay = `${KNEE_WARMUP + (k - 1) * STEP_SECONDS + 10}s`;
    thresholds[`http_req_duration{step:${k}}`] = [
      { threshold: 'p(95)<300', abortOnFail: true, delayAbortEval: delay },
    ];
    thresholds[`http_req_failed{step:${k}}`] = [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: delay }];
    thresholds[`http_req_duration{step:${k},endpoint:leaderboard}`] = ['max>=0'];
    thresholds[`http_req_duration{step:${k},endpoint:report}`] = ['max>=0'];
    thresholds[`http_reqs{step:${k}}`] = ['count>=0'];
  }
} else {
  throw new Error(`unknown PROFILE ${PROFILE}`);
}

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  scenarios,
  thresholds,
};

// Wall-clock start of the scenarios, used to align server-side samples with phases/steps.
export function setup() {
  console.log(`K6_T0_MS=${Date.now()}`);
}

const randInt = (n) => Math.floor(Math.random() * n);
const LEAGUES = Math.floor(PLAYERS / LEAGUE_SIZE);
const playerId = (league, slot) => `p${(league - 1) * LEAGUE_SIZE + slot + 1}`;

function tags(endpoint) {
  const t = { endpoint };
  if (PROFILE === 'knee') {
    const s = exec.instance.currentTestRunDuration / 1000 - KNEE_WARMUP;
    t.step = s < 0 ? '0' : String(Math.min(KNEE_MAX_STEPS, 1 + Math.floor(s / STEP_SECONDS)));
  }
  return t;
}

export function readLeaderboard() {
  const me = playerId(1 + randInt(LEAGUES), randInt(LEAGUE_SIZE));
  const res = http.get(`${BASE}/leagues/me/leaderboard`, {
    headers: { 'X-Player-Id': me },
    tags: tags('leaderboard'),
  });
  check(res, { 'leaderboard 200': (r) => r.status === 200 });
}

export function reportPair() {
  const league = 1 + randInt(LEAGUES);
  const a = randInt(LEAGUE_SIZE);
  const b = (a + 1 + randInt(LEAGUE_SIZE - 1)) % LEAGUE_SIZE; // distinct from a
  const p1 = playerId(league, a);
  const p2 = playerId(league, b);
  const winner = Math.random() < 0.5 ? p1 : p2;
  const url = `${BASE}/matches/${crypto.randomUUID()}/report`; // same id format as the seed
  const t = tags('report');
  const params = (me) => ({ headers: { 'X-Player-Id': me, 'Content-Type': 'application/json' }, tags: t });
  const body1 = JSON.stringify({ opponentId: p2, winnerId: winner });

  const [r1, r2] = http.batch([
    ['POST', url, body1, params(p1)],
    ['POST', url, JSON.stringify({ opponentId: p1, winnerId: winner }), params(p2)],
  ]);
  const statuses = [r1.status, r2.status].sort();
  check(null, { 'pair -> one 201 and one 202': () => statuses[0] === 201 && statuses[1] === 202 });

  if (Math.random() < DUP_PAIR_PROB) {
    const dup = http.post(url, body1, params(p1));
    check(dup, { 'duplicate -> 200': (r) => r.status === 200 });
  }
}
