#!/usr/bin/env node
// Summarises one measured run from its files (see scripts/measure.sh). No dependencies.
// Usage: node scripts/summarize-run.mjs evidence/<NN>-<label> <smoke|target|knee>
// Time alignment: K6_T0_MS (printed by the scenario's setup()) marks the start of the
// scenarios. Server-side series are cut to a phase/step by wall-clock timestamp; app metric
// windows (5 s) are included only if they lie entirely inside the range.
import { readFileSync, existsSync } from 'node:fs';

const [D, PROFILE] = process.argv.slice(2);
const env = process.env;
const dur = (s, d) => {
  const m = /^(\d+)(ms|s|m)?$/.exec(s ?? d);
  return Number(m[1]) * ({ ms: 1, s: 1000, m: 60000 }[m[2] ?? 's']);
};
const read = (name) => (existsSync(`${D}/${name}`) ? readFileSync(`${D}/${name}`, 'utf8') : '');
// snapshots.txt holds "## <name>" sections.
const sections = Object.fromEntries(
  read('snapshots.txt')
    .split(/^## /m)
    .filter(Boolean)
    .map((b) => [b.slice(0, b.indexOf('\n')).trim(), b.slice(b.indexOf('\n') + 1)]),
);
const parseCsv = (text) => {
  const [h, ...rows] = (text ?? '').trim().split('\n');
  if (!h) return [];
  const keys = h.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], v])));
};
const f = (x, d = 1) => (x == null || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const q = (xs, p) => {
  if (!xs.length) return NaN;
  const s = Float64Array.from(xs).sort();
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const csv = (section) => parseCsv(sections[section]);
const txt = read('k6.txt');
const T0 = Number(/K6_T0_MS=(\d+)/.exec(txt)?.[1]);
const k6Exit = /k6_exit=(\d+)/.exec(txt)?.[1];
const summary = JSON.parse(read('k6.json') || '{"metrics":{}}');
const M = summary.metrics;
const metric = (name) => M[name] ?? null;
const ms = (t) => Date.parse(t);

// samples.csv: one row per second with cgroup and pg_stat_activity columns. Runs 00-03 were
// sampled by two separate loops, so their rows carry one group or the other.
const samples = parseCsv(read('samples.csv')).map((r) => ({ t: ms(r.ts), ...r }));
const act = samples.filter((r) => r.active !== '' && r.active !== undefined);
const cg = samples.filter((r) => r.cpu_usage_usec !== '' && r.cpu_usage_usec !== undefined);
const app = read('app.jsonl')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .map((l) => ({ ...l, end: ms(l.t), start: ms(l.t) - l.window_ms }));

function server(from, to) {
  const a = act.filter((r) => r.t >= from && r.t <= to);
  const col = (k) => a.map((r) => Number(r[k]));
  const c = cg.filter((r) => r.t >= from && r.t <= to);
  const out = {
    samples: a.length,
    activeAvg: mean(col('active')),
    activeMax: Math.max(...col('active')),
    idleTxAvg: mean(col('idle_in_tx')),
    lockSamples: col('active_lock').filter((x) => x > 0).length,
    lwlockSamples: col('active_lwlock').filter((x) => x > 0).length,
    ioSamples: col('active_io').filter((x) => x > 0).length,
  };
  if (c.length >= 2) {
    const [x, y] = [c[0], c[c.length - 1]];
    const dt = (y.t - x.t) * 1000; // µs
    const d = (k) => Number(y[k]) - Number(x[k]);
    // Per-process ticks are summed per class each second; when a backend exits its lifetime
    // ticks vanish from the sum, so add up only non-negative 1-s deltas.
    const pos = (k) => c.slice(1).reduce((acc, r, i) => acc + Math.max(0, Number(r[k]) - Number(c[i][k])), 0);
    const ticks = pos('node_ticks') + pos('postgres_ticks') + pos('other_ticks');
    // Share of 100-ms CFS periods in which the box hit its 1-CPU quota. nr_periods is
    // sampled from run 05 on; earlier runs fall back to wall-clock periods (approximate).
    const periods = y.nr_periods ? d('nr_periods') : dt / 100_000;
    Object.assign(out, {
      cpuPct: (100 * d('cpu_usage_usec')) / dt,
      throttledPct: (100 * d('nr_throttled')) / periods,
      nodeShare: (100 * pos('node_ticks')) / ticks,
      pgShare: (100 * pos('postgres_ticks')) / ticks,
      memMaxMiB: Math.max(...c.map((r) => Number(r.mem_current))) / 2 ** 20,
      anonMaxMiB: Math.max(...c.map((r) => Number(r.mem_anon))) / 2 ** 20,
      memMaxHits: y.mem_max_events ? d('mem_max_events') : null,
    });
  }
  const w = app.filter((l) => l.start >= from - 500 && l.end <= to + 500);
  const raw = (ep, k) => w.flatMap((l) => l[ep]?.raw?.[k] ?? []);
  out.app = {};
  for (const ep of ['leaderboard', 'report']) {
    const db = raw(ep, 'db_ms');
    const pw = raw(ep, 'pool_wait_ms');
    out.app[ep] = { hits: w.reduce((t, l) => t + (l[ep]?.cache_hits ?? 0), 0), n: db.length, dbMean: mean(db), dbP95: q(db, 0.95), dbP99: q(db, 0.99), pwP95: q(pw, 0.95), pwP99: q(pw, 0.99), pwMax: Math.max(...pw) };
  }
  const allDb = [...raw('leaderboard', 'db_ms'), ...raw('report', 'db_ms')];
  const secs = w.length * 5;
  out.app.all = { n: allDb.length, dbMean: mean(allDb), dbP95: q(allDb, 0.95), dbP99: q(allDb, 0.99), rps: allDb.length / secs };
  out.waitingMax = Math.max(0, ...w.map((l) => l.pool?.waiting_max ?? 0));
  out.eluAvg = mean(w.map((l) => l.event_loop.utilization));
  out.loopDelayP99Max = Math.max(...w.map((l) => l.event_loop.delay_p99_ms));
  out.appWindows = w.length;
  return out;
}

function lines(s) {
  const o = [];
  const a = s.app;
  o.push(`  DB time/request, app connect->release (ms): leaderboard mean ${f(a.leaderboard.dbMean, 2)} p95 ${f(a.leaderboard.dbP95, 2)} p99 ${f(a.leaderboard.dbP99, 2)} (n=${a.leaderboard.n}) | report mean ${f(a.report.dbMean, 2)} p95 ${f(a.report.dbP95, 2)} p99 ${f(a.report.dbP99, 2)} (n=${a.report.n})`);
  if (cacheMs !== '0') o.push(`  leaderboard cache (${cacheMs} ms): ${a.leaderboard.hits} of ${a.leaderboard.n} reads served without SQL (${f((100 * a.leaderboard.hits) / a.leaderboard.n)}%); they count as 0 ms DB time below`);
  o.push(`  DB time/request, all requests (C9): mean ${f(a.all.dbMean, 3)} p95 ${f(a.all.dbP95, 3)} p99 ${f(a.all.dbP99, 3)} ms (n=${a.all.n}) | Little's law: ${f(a.all.rps)} req/s x ${f(a.all.dbMean, 3)} ms = ${f((a.all.rps * a.all.dbMean) / 1000, 2)} connections held`);
  o.push(`  pool wait (ms): leaderboard p95 ${f(a.leaderboard.pwP95, 3)} p99 ${f(a.leaderboard.pwP99, 3)} max ${f(a.leaderboard.pwMax, 1)} | report p95 ${f(a.report.pwP95, 3)} p99 ${f(a.report.pwP99, 3)} max ${f(a.report.pwMax, 1)} | waiting_max ${s.waitingMax}`);
  o.push(`  busy DB conns (pg_stat_activity active, ${s.samples} x 1 s): avg ${f(s.activeAvg, 2)} max ${s.activeMax} | idle-in-tx avg ${f(s.idleTxAvg, 2)} | samples with Lock ${s.lockSamples}, LWLock ${s.lwlockSamples}, IO ${s.ioSamples}`);
  o.push(`  box CPU ${f(s.cpuPct)}% of one CPU (limit ${cpus} CPU), quota hit in ${f(s.throttledPct)}% of 100-ms periods | split node ${f(s.nodeShare)}% / postgres ${f(s.pgShare)}% | mem max ${f(s.memMaxMiB, 0)} MiB (anon ${f(s.anonMaxMiB, 0)}), memory.max hits ${s.memMaxHits ?? 'not sampled'}`);
  o.push(`  node event loop: utilization avg ${f(s.eluAvg, 2)}, delay p99 max ${f(s.loopDelayP99Max, 1)} ms (${s.appWindows} windows)`);
  return o;
}

// memory.events counters are since container start: report the change during the run.
const memev = (k) => Object.fromEntries((sections[`memevents_${k}`] ?? '').split('\n').map((l) => l.split(' ')).filter((x) => x.length === 2));
const [mb, ma] = [memev('before'), memev('after')];
const memEvents = 'oom_kill' in ma ? `memory.events during run: max +${ma.max - mb.max}, oom +${ma.oom - mb.oom}, oom_kill +${ma.oom_kill - mb.oom_kill}` : null;

const out = [];
out.push(`${D.split('/').pop()}  profile=${PROFILE}  k6_exit=${k6Exit}`);
// Enough context to reproduce: command, code version, host, box limits, Postgres settings.
const mach = [sections.machine, sections.host, sections.box].join('\n').split('\n'); // runs 00-04 had host/box subsections
const pick = (re) => mach.find((l) => re.test(l))?.trim() ?? 'n/a';
const cacheMs = /leaderboard_cache_ms=(\S+)/.exec(pick(/^node=/))?.[1] ?? '0'; // runs before the cache existed = cache off
const cpus = Number(/nano_cpus=(\d+)/.exec(pick(/nano_cpus=/))?.[1] ?? 1e9) / 1e9;
const cpuset = /cpuset=(\S*)/.exec(pick(/nano_cpus=/))?.[1] || 'any';
const kenv = /k6_env: (.*)/.exec(pick(/k6_env:/))?.[1].split(' ').filter((x) => !x.endsWith('=')).join(' ') ?? '';
const boxArgs = [cpus !== 1 && `BOX_CPUS=${cpus}`, /memory=(\d+)/.exec(pick(/nano_cpus=/))?.[1] !== '1073741824' && `BOX_MEMORY=${Number(/memory=(\d+)/.exec(pick(/nano_cpus=/))?.[1]) / 2 ** 30}g`, cpuset !== 'any' && `BOX_CPUSET=${cpuset}`, cacheMs !== '2000' && `LEADERBOARD_CACHE_MS=${cacheMs}`].filter(Boolean).join(' ');
const k6cpus = /k6_cpuset=(\S+)/.exec(pick(/k6_image=/))?.[1];
out.push(`  reproduce: make box-up${boxArgs ? ' ' + boxArgs : ''} && make measure PROFILE=${PROFILE}${kenv ? ' ' + kenv : ''}${k6cpus ? ' K6_CPUSET=' + k6cpus : ''}   (dataset: make box-seed, see evidence/seed.txt)`);
out.push(`  run: ${pick(/^date_utc=/)}`);
out.push(`  host: ${pick(/^Model name/).replace(/\s+/g, ' ')} | ${pick(/^CPU\(s\)/).replace(/\s+/g, ' ')} | ${pick(/^other_running_containers=/)}`);
out.push(`  ${pick(/^(box: )?image=/).replace(/(box: )?image=\S+ /, 'box: ')} | ${pick(/^node=/)} | ${pick(/^PostgreSQL /).split(' on ')[0]} | ${['shared_buffers', 'max_connections', 'synchronous_commit'].map((k) => pick(new RegExp(`^${k}=`))).join(' ')}`);
const checks = Object.entries(summary.root_group?.checks ?? {}).map(([k, v]) => `${k}: ${v.passes} ok / ${v.fails} fail`);
out.push(`  checks: ${checks.join(' | ') || 'n/a'} | dropped_iterations ${metric('dropped_iterations')?.count ?? 0}`);

if (PROFILE === 'smoke' || PROFILE === 'target') {
  const ramp = PROFILE === 'smoke' ? 0 : dur(env.RAMP, '30s');
  const hold = PROFILE === 'smoke' ? 30000 : dur(env.HOLD, '2m');
  const target = PROFILE === 'smoke' ? 20 : Number(env.TARGET_RPS || 540);
  const d = (k) => metric(`http_req_duration{${k}}`) ?? {};
  const all = d('phase:steady');
  const lb = d('phase:steady,endpoint:leaderboard');
  const rp = d('phase:steady,endpoint:report');
  const fail = metric('http_req_failed{phase:steady}') ?? {};
  const reqs = metric('http_reqs{phase:steady}')?.count ?? 0;
  const err = fail.value ?? NaN;
  out.push(`  steady ${hold / 1000}s: target ${target} rps, achieved ${f(reqs / (hold / 1000))} rps (${reqs} req)`);
  out.push(`  latency ms: all p95 ${f(all['p(95)'])} p99 ${f(all['p(99)'])} max ${f(all.max)} | leaderboard p95 ${f(lb['p(95)'])} p99 ${f(lb['p(99)'])} | report p95 ${f(rp['p(95)'])} p99 ${f(rp['p(99)'])}`);
  out.push(`  errors: ${f(100 * err, 3)}% (${fail.passes ?? '?'} of ${reqs})`);
  const slo = all['p(95)'] < 300 && all['p(99)'] < 800 && err < 0.001;
  out.push(`  SLO p95<300 p99<800 err<0.1%: ${slo ? 'PASS' : 'FAIL'}`);
  const pe = csv('pgss_endpoint');
  out.push(`  DB time/request, server (pg_stat_statements, whole run incl. ramp): ${pe.map((r) => `${r.endpoint} mean ${r.mean_ms_per_call ?? r.mean_ms_per_request} ms per SQL call (${r.calls ?? r.requests} calls, max stmt ${r.max_single_statement_ms} ms)`).join(' | ')}`);
  out.push(...lines(server(T0 + ramp, T0 + ramp + hold)));
} else {
  const S = dur(env.STEP_SECONDS ? `${env.STEP_SECONDS}s` : undefined, '60s');
  const start = Number(env.KNEE_START || 100);
  const step = Number(env.KNEE_STEP || 100);
  const W = Number(env.KNEE_WARMUP || 0) * 1000; // warm-up ramp before step 1
  let knee = null;
  let broken = false;
  // Real length of the last (possibly aborted) step, from k6's final progress line.
  const prog = [...txt.matchAll(/running \((\d+)m(\d+(?:\.\d+)?)s\)/g)].pop();
  const total = prog ? (Number(prog[1]) * 60 + Number(prog[2])) * 1000 : Infinity;
  out.push('  step offered achieved  p95    p99   err%   lb_p95 rep_p95 | cpu% thr% node% pg%  act_avg/max pool_p95 dbapp_p95(lb/rep) elu  loop_p99 memhit | pass');
  for (let k = 1; ; k++) {
    const reqs = metric(`http_reqs{step:${k}}`)?.count ?? 0;
    if (!reqs) break;
    const d = metric(`http_req_duration{step:${k}}`);
    const lb = metric(`http_req_duration{step:${k},endpoint:leaderboard}`) ?? {};
    const rp = metric(`http_req_duration{step:${k},endpoint:report}`) ?? {};
    const err = metric(`http_req_failed{step:${k}}`)?.value ?? NaN;
    const secs = Math.min(S, total - W - (k - 1) * S) / 1000;
    const s = server(T0 + W + (k - 1) * S, T0 + W + (k - 1) * S + secs * 1000);
    const pass = d['p(95)'] < 300 && err < 0.01;
    if (pass && !broken) knee = start + (k - 1) * step;
    if (!pass) broken = true;
    const pw = Math.max(s.app.leaderboard.pwP95 || 0, s.app.report.pwP95 || 0);
    out.push(
      `  ${String(k).padStart(4)} ${String(start + (k - 1) * step).padStart(7)} ${f(reqs / secs).padStart(8)} ${f(d['p(95)']).padStart(6)} ${f(d['p(99)']).padStart(6)} ${f(100 * err, 2).padStart(6)} ${f(lb['p(95)']).padStart(7)} ${f(rp['p(95)']).padStart(7)} | ${f(s.cpuPct).padStart(4)} ${f(s.throttledPct).padStart(4)} ${f(s.nodeShare).padStart(5)} ${f(s.pgShare).padStart(4)} ${f(s.activeAvg, 2).padStart(7)}/${String(s.activeMax).padEnd(3)} ${f(pw, 2).padStart(7)} ${f(s.app.leaderboard.dbP95, 1)}/${f(s.app.report.dbP95, 1)} ${f(s.eluAvg, 2)} ${f(s.loopDelayP99Max, 1).padStart(6)} ${String(s.memMaxHits ?? '-').padStart(6)} | ${pass ? 'PASS' : 'FAIL'}${secs < S / 1000 ? ` (aborted after ${f(secs, 0)} s)` : ''}`,
    );
  }
  out.push(`  KNEE (last consecutive step with p95<300 ms and errors<1%): ${knee ?? 'none'} rps`);
  const pe = csv('pgss_endpoint');
  out.push(`  DB time/request, server (pg_stat_statements, whole run): ${pe.map((r) => `${r.endpoint} mean ${r.mean_ms_per_call ?? r.mean_ms_per_request} ms per SQL call`).join(' | ')}`);
}
const sz = csv('sizes_before');
out.push(`  C7 bytes/row before run (total incl. indexes): ${sz.filter((r) => r.row_count).map((r) => `${r.table_name} ${r.total_bytes_per_row} (${r.row_count} rows)`).join(' | ')} | DB ${f(Number(sz.find((r) => r.table_name === 'DATABASE')?.total_bytes) / 2 ** 20, 0)} MiB`);
console.log(out.join('\n'));
// Growth during the run: bytes the app's own inserts added per new row (page-granular).
const sa = csv('sizes_after');
const grew = sz
  .filter((r) => r.row_count)
  .map((b) => [b, sa.find((a) => a.table_name === b.table_name)])
  .filter(([b, a]) => a && Number(a.row_count) > Number(b.row_count));
if (grew.length) {
  console.log(
    `  C7 growth during run (delta total_bytes / delta rows): ${grew.map(([b, a]) => `${b.table_name} ${f((a.total_bytes - b.total_bytes) / (a.row_count - b.row_count))} (+${a.row_count - b.row_count} rows)`).join(' | ')}`,
  );
}
// Disk vs cache: page-cache pressure on the 1 GB box shows up as slow shared_blks_read.
{
  const pg = csv('pgss');
  const sum = (k) => pg.reduce((t, r) => t + Number(r[k] || 0), 0);
  const rd = sum('shared_blks_read'), ms = sum('blk_read_ms'), hit = sum('shared_blks_hit');
  if (pg.length) console.log(`  DB block reads (pg_stat_statements top 30): ${rd} read from disk/page cache in ${f(ms, 1)} ms = ${rd ? f(ms / rd, 3) : '-'} ms/block | ${hit} shared_buffers hits`);
}
if (memEvents) console.log(`  ${memEvents}`);
