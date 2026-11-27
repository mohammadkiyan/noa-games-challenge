<!-- cap: 250 words -->
# AI notes

**Hours:** Active work per sitting was not recorded reliably. Conversation evidence shows work on Nov 17, 18, 23 and 27, 2026; timestamps are not active hours. I cannot substantiate a total or certify the six-hour cap.

**Tools:** Claude web drafted requirements, specs and reviewed capacity; Claude Code implemented the slice, ran tests and benchmarks (Opus 5.5 per prompt log); ChatGPT reviewed commits, challenged claims and generated bounded correction prompts. Historical web model IDs and actual reasoning-effort settings are unavailable. See transcripts and prompt log.

**Usage:** I requested evidence for critical numbers, then rejected further 30–40-minute runs in favor of labeled estimates. Kept the slice narrow and reused raw measurements. Claude web quota was reached during evidence preparation; switched to exporting existing conversations and consolidating with ChatGPT. No historical usage screenshots retained. No verified token totals or invoices; CAPACITY uses public subscription list-price estimates, not billed costs.

**Mistake:** The AI implementation originally credited a Sunday match confirmed Monday to the new week. Review uncovered the mismatch with first-report-week semantics. Migration 003 and two regression tests corrected it; CI reports 15/15 tests. Wrong rankings could lead to wrong promotions/rewards.

**Next time:** Record active time, usage snapshots, model settings and acceptance/rejection decisions as work happens; keep raw benchmark outputs from the first commit and capture source revisions. Prioritize the brief's time-box over repeated review cycles.
