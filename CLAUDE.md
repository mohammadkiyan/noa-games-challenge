# Project: Hexabout Leagues take-home slice
Stack: Node 22, TypeScript, Fastify, pg (raw SQL), Postgres 16, Vitest, k6.

Rules
1. Scope = ONE write endpoint + ONE read endpoint + real Postgres + README. Nothing else.
2. Never invent numbers. Any figure in LOADTEST.md / CAPACITY.md must come from a file in evidence/ or from math shown in the doc.
3. Coin/points writes are atomic SQL (points = points + 1), never read-modify-write in app code.
4. Every write path must be safe to receive twice. Prove it with a test.
5. Doc page caps (1 page = 500 words): PRD 500, DESIGN 1000, CAPACITY 500, LOADTEST 500, OPS 500, ROADMAP 500, CHANGE-RESPONSE 500, AI-NOTES 250. Run `make docs-check` before finishing.
6. Keep prompts that mattered: append to ai/PROMPT-LOG.md (prompt, what I accepted, what I rejected and how I found the problem).
7. No secrets in the repo. Config via env vars, `.env.example` only.
8. Ask me before adding any dependency not listed above.
