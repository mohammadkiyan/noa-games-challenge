# Prompt log

Only prompts that mattered. Newest at the bottom. Full transcripts go in `ai/transcripts/`.

Template:

```
## <n>. <short title> (<date>, <tool/model>)
Prompt:   <the prompt, or a link to the transcript>
Got:      <what came back, in one or two lines>
Accepted: <what I kept>
Rejected: <what I threw away>; how I found the problem: <test, review, EXPLAIN, load test...>
```

## 1. Codebase init spec (2026-11-17, Claude Code / Claude Opus 5.5)
Prompt:   the init spec (sections 0–11), pasted as the first prompt.
Got:      repo skeleton, report + leaderboard endpoints, 12 Vitest tests, seed, k6 scenario, doc stubs, CI. Tests were
          run against stubs first (10 failed). Test 2 failed with the advisory lock removed (`[202, 202]`, result lost).
          Test 5 failed with a read-modify-write update (20 points instead of 40; a 5 ms sleep was added to widen the race).
Accepted:
Rejected:

## 2. Measured capacity numbers (2026-11-17/18, Claude Code / Claude Opus 5.5)
Prompt:   the measurement spec (sections 0–9: box limits, seed, `make measure`, k6 smoke/target/knee, find the first
          bottleneck, propose one fix), then "fewer files; reviewer reruns; summaries over raw; update CAPACITY.md".
Got:      1-CPU/1-GB box image, end-of-week seed, `make measure` (k6 + 1 s cgroup/pg_stat_activity sampler +
          pg_stat_statements + app pool/DB timing), summaries in `evidence/`, raw in git-ignored `.runs/`.
          First bottleneck = the 1 vCPU (run 03). Node CPU profile (run 04) showed per-round-trip cost; fix = report as
          one SQL function call (migration 002). Test 2 still fails with the lock removed (`[202, 202]`).
          Result: 800 rps p95 79.6 -> 12.9 ms, but the 100-rps knee stayed at 800; a cold/evicted page cache
          (box at memory.max) showed up as 450 ms report stalls.
Accepted:
Rejected:

## 3. Reviewer fixes for CAPACITY.md (2026-11-18, Claude Code / Claude Opus 5.5)
Prompt:   "Fix all reviewers comments, and also do the remaining tasks" + the pasted review (over 500 words; knee is not
          a capacity number; vertical before split; real Hetzner box; RAM argument; C3/C5 reasoning; UUID sizes; was the
          cache on?), then "we don't need evidence for everything now; a little load test for the initial state, then estimate".
Got:      The leaderboard cache from DESIGN.md had never been built: every earlier run was cache-off. Built it (per league,
          2 s TTL, dropped on a recorded win) + test. Re-measured: knee 800 -> 1,200 rps (`evidence/11`), 540 rps p99
          32.4 -> 5.9 ms, CPU 74% -> 56% (`evidence/12`), 0 OOM kills. `make id-size` (`evidence/id-size.txt`).
          CAPACITY.md rewritten (safe = 70% of knee, CPX22 before pushes, vertical first); push/cold-start runbook in OPS.md.
          docs-check now counts table cells too (PRD and DESIGN now show over cap).
Accepted:
Rejected:
