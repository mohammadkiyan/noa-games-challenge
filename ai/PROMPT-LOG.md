# Prompt log

Ten significant prompts, with selected transcripts under `ai/transcripts/`. Entries 1–7 preserve the existing Claude Code log; 8–10 add web/review episodes retrospectively. Explicit user instructions are distinguished from retained changes and AI-reported verification. Where personal acceptance is not recorded, say so.

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
Accepted: The narrow slice and atomic SQL/advisory lock are retained in the repository; explicit per-decision approval not recorded.
Rejected: The unlocked and read-modify-write alternatives failed recorded concurrency tests. See slice/test/reportMatch.test.ts; failures described in the original agent log, not independently rerun.

## 2. Measured capacity numbers (2026-11-17/18, Claude Code / Claude Opus 5.5)
Prompt:   the measurement spec (sections 0–9: box limits, seed, `make measure`, k6 smoke/target/knee, find the first
          bottleneck, propose one fix), then "fewer files; reviewer reruns; summaries over raw; update CAPACITY.md".
Got:      1-CPU/1-GB box image, end-of-week seed, `make measure` (k6 + 1 s cgroup/pg_stat_activity sampler +
          pg_stat_statements + app pool/DB timing), summaries in `evidence/`, raw in git-ignored `.runs/`.
          First bottleneck = the 1 vCPU (run 03). Node CPU profile (run 04) showed per-round-trip cost; fix = report as
          one SQL function call (migration 002). Test 2 still fails with the lock removed (`[202, 202]`).
          Result: 800 rps p95 79.6 -> 12.9 ms, but the 100-rps knee stayed at 800; a cold/evicted page cache
          (box at memory.max) showed up as 450 ms report stalls.
Accepted: Requested evidence-based local measurements (claude-planning.md); SQL function retained (migration 002).
Rejected: Treating latency improvement as a throughput increase; the measured knee stayed at 800. Verify evidence/03-knee.txt and evidence/08-knee.txt.

## 3. Reviewer fixes for CAPACITY.md (2026-11-18, Claude Code / Claude Opus 5.5)
Prompt:   "Fix all reviewers comments, and also do the remaining tasks" + the pasted review (over 500 words; knee is not
          a capacity number; vertical before split; real Hetzner box; RAM argument; C3/C5 reasoning; UUID sizes; was the
          cache on?), then "we don't need evidence for everything now; a little load test for the initial state, then estimate".
Got:      The leaderboard cache from DESIGN.md had never been built: every earlier run was cache-off. Built it (per league,
          2 s TTL, dropped on a recorded win) + test. Re-measured: knee 800 -> 1,200 rps (`evidence/11`), 540 rps p99
          32.4 -> 5.9 ms, CPU 74% -> 56% (`evidence/12`), 0 OOM kills. `make id-size` (`evidence/id-size.txt`).
          CAPACITY.md rewritten (safe = 70% of knee, CPX22 before pushes, vertical first); push/cold-start runbook in OPS.md.
          docs-check now counts table cells too (PRD and DESIGN now show over cap).
Accepted: Requested a small initial test then estimation rather than evidence for every forecast; cache and supporting test retained.
Rejected: Assuming the design cache was already implemented; code review found it missing. Verify evidence/11-knee-cache.txt and evidence/12-target-cache.txt; exact human approval of each fix unknown.

## 4. Second CAPACITY review, no new runs (2026-11-18, Claude Code / Claude Opus 5.5)
Prompt:   pasted review ("CPU first" vs 0.80 CPU at the knee; C9 p95 looks copied; rescale disk trap; one run per
          data point; cost table; 60k € figure; Storage Box price; Hetzner-account SPOF), then "no 30-40 min runs;
          do the other fixes and rely on our estimation".
Got:      Checked each claim against `evidence/` first. The throttling check the reviewer asked for was already
          measured (`thr%` in `11`: 9.1% -> 35.5% at 1,200 -> 1,300 rps), so the doc now says "CPU quota" and cites it.
          C9 p95 not copied: 2.511 (`07`) vs 2.513 (`12`); every read is below it, so the cache can't move it.
          Recomputing 1,200 / (0.801 x 0.667) gave 2,246, not 2,260 (rounding): now "<= 2,250, upper bound".
          Cost table, push-day math, knee "1 run", rescale drill in OPS.md, Hetzner-account SPOF row in DESIGN.md.
          make docs-check found PRD (516) and DESIGN (1049) over cap; cut both.
Accepted: all doc fixes; 2,250 upper bound without the --cpus=2 run.
Rejected: new load runs (time). Reviewer's "a few EUR per push": (19.49 - 5.99) / 730 h x 24 h = EUR 0.44/push day.
          Storage Box price (3.20 vs claimed 3.81) not verified either way: doc says "re-check".

## 5. Commit the raw load-test output (2026-11-27, Claude Code / Claude Opus 5.5)
Prompt:   "Keep the raw output in the repository."
Got:      `.runs/` was git-ignored, so `evidence/*.txt` cited files (e.g. `.runs/03-knee/snapshots.txt`) a reviewer could
          not open. Removed the ignore and committed `.runs/` (78 files, 18 MB, largest 4.6 MB: no LFS needed).
          Grepped it for password/secret/token/postgres:// first: only V8 function names in the cpuprofile.
Accepted: Explicitly requested raw output be retained; .runs/ is now tracked.
Rejected: Summary-only evidence; reviewer would not be able to open cited snapshots. Verify commit 1d40de7.

## 6. Targeted corrections 1-3 to the docs (2026-11-27, Claude Code / Claude Opus 5.5)
Prompt:   three pasted correction briefs (LOADTEST only; OPS/DESIGN/CHANGE-RESPONSE; PRD/CAPACITY/ROADMAP/README),
          each "no code, no evidence changes, no invented numbers, no commit".
Got:      Payout cap and manual approval as Must (value left to the owner); Leagues on / Coins on gates with a fixed
          launch date; weekly members as scenarios (0.6M / 1.2M / 4.2M -> 12k / 24k / 84k leagues, rehearse at 4.2M);
          4-7 corrected to 4-8 vCPU (3.58 / 0.5 = 7.2); scale-down kept as a candidate trigger with a check and rollback.
          While checking README against the code it found the week-boundary bug: report_match() used the second
          report's week, so Sunday 23:59:59 + Monday 00:00:01 counted in the new week. Documented, not fixed (no code).
          Also caught its own unsourced "540k new players" (600k x 90%, never given) and replaced it with <= 600k.
Accepted: Requested targeted correction prompts and reported phases complete; changes retained in PRD, OPS, CAPACITY and ROADMAP. Individual approval not recorded.
Rejected: sizing CPU on 4.2M weekly members (requests follow DAU); writing a cap value or an AI price (not in repo).

## 7. Phase 3 items: week-boundary fix and evidence checks (2026-11-27, Claude Code / Claude Opus 5.5)
Prompt:   "do it by yourself" (the open Phase 3 items from correction 3).
Got:      Migration 003: match_reports.week_id; report_match() records the result and the point in the first report's
          week (pre-003 rows: UTC ISO week of created_at). Seed writes week_id. Tests 6 and 6b (fake Date, Sunday
          23:59:59 -> Monday 00:00:01, retries in the new week return duplicate). Both fail without 003
          (expected 202001, received 202002) and pass with it: 15/15.
          Storage Box: Hetzner lists BX11 at EUR 3.20/month excl. VAT; 3.81 is with 19% German VAT. Both were right.
          evidence/04-profile.txt line 52 cites memory.events from .runs/03-knee/snapshots.txt, which has no
          memory.events section: that claim is unsupported (LOADTEST already says "unsampled"). OOM counters exist
          only for runs 11-13; 08-10 reach mem_current 1024 MiB (samples.csv) but have no OOM counter.
          Left as is (historical evidence): see the notes above.
Accepted: Explicitly authorized the correction ('do it by yourself'); migration 003 and tests retained.
Rejected: Assigning the week from the second report; regression tests 6/6b caught it. OOM assertion for runs 08–10 was not supported by recorded counters. Verify migration 003, test file and LOADTEST.md.

## 8. Product scoping (2026-11-17/18, Claude web; model unknown)
Prompt: "No I don't like your email and also these are not my top 5 questions. instead give me specs for my Claude code to initiate the codebase structures"; later asked for aggressive criticism of assumptions.
Got: Revised scope and implementation specs; alternatives for matchmaking, optimistic UI, identity, and incomplete reports.
Accepted: Explicitly agreed to first-come-first-served, version checks, greyed-out disputes, local JWT assumption, and never counting single reports in MVP.
Rejected or corrected: Initial clarification questions; production WebSockets/local midnight/instant rewards were more complex than code alone. Human review of one-report cases was retained only as Could.
Verification: Recorded decisions in [Claude planning transcript](transcripts/claude-planning.md); compare PRD and DESIGN.

## 9. Adapt to company response (2026-11-23/27, Claude web + ChatGPT)
Prompt: "I want to know your idea about their answers"; later "We should update the design.md by attention to the change request email" and requested PRD, CAPACITY, CHANGE-RESPONSE updates.
Got: 600k DAU scenario, first-hour traffic assumptions, temporary larger server, cut clubs, independent backups and graceful degradation.
Accepted: Requested the change response and reported Phase 1 complete; committed plan keeps fixed date and defers clubs. Individual recommendation acceptance not separately recorded.
Rejected or corrected: Treating historical 3x campaign as proof of 10x capacity; treating weekly uniques as DAU; unconfirmed percentage of new players.
Verification: Actual email requirements, [Claude review](transcripts/claude-verification.md), [ChatGPT review](transcripts/chatgpt-review-transcript.md), commit acc4445, CAPACITY and CHANGE-RESPONSE.

## 10. Independent technical audit (2026-11-27, ChatGPT + Claude Code)
Prompt: "give me phase 3", then "check again" after corrections.
Got: Evidence-first audit; confirmed-fencing policy, shared/exclusive week-close barrier, pre-003 benchmark disclosure, documented collision and cache limitations.
Accepted: User proceeded to evidence export following review; corrections retained in commit 4f0a99e. Personal approval of each technical proposal not recorded.
Rejected or corrected: Credential rotation alone as DB fencing; grace-period-only close; zero OOM claims without counters; treating historical measurements as post-003 performance.
Verification: [ChatGPT review](transcripts/chatgpt-review-transcript.md), DESIGN, OPS and LOADTEST; CI run 46006129508 passed 15 tests but failed on a cap marker quoted inside a transcript (not an actual document cap).
