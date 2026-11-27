# PRD: Hexabout Leagues (MVP, 12 weeks)

## 1. Core loop
Version check → play a match → winner sees +1 instantly, confirmed in seconds → climb the weekly league of 50 → at reset, the top move up a tier with coins; the bottom move down.

## 2. Scope (MoSCoW)
| | Item |
|---|---|
| **Must** | Minimum app version; join a same-tier league of 50 on first weekly match |
| **Must** | +1 per win, no draws; ties: first to reach it wins |
| **Must** | Leaderboard: optimistic update, polling sync; disputed results greyed out |
| **Must** | Global weekly reset: points → 0, tier stays; unfinished matches don't count |
| **Must** | 5 named tiers, promotion/demotion zones; coins only on promotion, paid once, payout guard |
| **Must** | Anti-cheat: dual report, rate limits, delayed payout |
| **Should** | Manual first payouts; anomaly alert |
| **Could** | One-report matches: phone retry queue → auto rule → human review |
| **Won't** | All of §6, skill matchmaking, a match server |

## 3. Non-goals
Gameplay changes, coin budget system, perfect anti-cheat.

## 4. Assumptions
| # | Assumption | From |
|---|---|---|
| A1 | One phone hosts; results stay on phones (app update needed) | Q1 |
| A2 | No coin limit; Leagues caps its payout | Q2 |
| A3 | Cheapest Hetzner (CPX02) as floor; load test decides | Q3 |
| A4 | Push = up to 5× peak, mostly new players | Q4 |
| A5 | Players cheat; late rewards OK | Q5 |
| A6 | Configurable reset time | Decision |
| A7 | Inactive players keep their tier | Decision |
| A8 | Leagues fill first-come-first-served | Decision |
| A9 | Wallet ignores repeated payment keys; else manual review | Research |
| A10 | Login issues a signed JWT; Leagues verifies it locally | Q6 |

## 5. Open questions (Q1–5 sent 2026-11-17, 19:17 UK; pending)
**Q1** Where do results go today? · **Q2** Reward coin limit? · **Q3** OK monthly server spend? · **Q4** Last push: what happened? · **Q5** Cheating so far; reward delay OK? · **Q6** (unsent: 5-question limit) Can we verify login tokens ourselves?

## 6. Cuts and what each costs
Working days, with / without AI (≈ 2×). † = platform project, not a feature.

| Cut | Product cost | With AI | Without |
|---|---|---|---|
| Global rank | Loses a PO-requested motivator | 4 | 8 |
| Friends + their leagues | Less social retention | 12 | 24 |
| Challenges | Less virality; enables win trading | 12 | 24 |
| WebSockets † | Few-second lag | 15 | 30 |
| Local-midnight reset † | Some regions reset in daytime | 20 | 40 |
| Instant rewards † | Coins arrive hours late | 20+ | 40+ |