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
| **Must** | Launch build: server-set polls, Retry-After, jittered backoff, retry queue, kill switch [CHG-04] |
| **Should** | Manual payout approval; absolute weekly coin cap [CHG-06] |
| **Could** | One-report matches: human review [CHG-04] |
| **Won't** | All of §6, skill matchmaking, a match server |

## 3. Non-goals
Gameplay changes, coin budget system, perfect anti-cheat.

## 4. Assumptions
| # | Assumption | From |
|---|---|---|
| A1 | Both phones know the result; only phones store it [CHG-01] | Q1 |
| A2 | No limit given; Leagues sets an absolute weekly cap [CHG-01] | Q2 |
| A3 | <$500/month normal, $2,000 launch week; dedicated vCPU [CHG-01] | Q3, CR |
| A4 | Launch: 10× DAU (600k), worst in hour 1; later pushes 5× peak (seen: 3×/2 days) [CHG-01] | Q4, CR |
| A5 | Players cheat; coins after week close + approval [CHG-01] | Q5 |
| A6 | Configurable reset time | Decision |
| A7 | Inactive players keep their tier | Decision |
| A8 | Leagues fill first-come-first-served | Decision |
| A9 | Wallet ignores repeated payment keys; else manual review | Research |
| A10 | Login issues a signed JWT; Leagues verifies it locally | Q6 |

## 5. Questions
Q1–5 answered 2026-11-23, mostly "your call"; CR = change request (CHANGE-RESPONSE.md). Send **Q6** (verify login tokens ourselves?) now. [CHG-01]

## 6. Cuts and what each costs
Days, with / without AI. † = platform project.

| Cut | Product cost | With AI | Without |
|---|---|---|---|
| Global rank | Loses a PO-requested motivator | 4 | 8 |
| Friends + their leagues | Less social retention | 12 | 24 |
| Challenges | Less virality; enables win trading | 12 | 24 |
| WebSockets † | Few-second lag | 15 | 30 |
| Local-midnight reset † | Some regions reset in daytime | 20 | 40 |
| Instant rewards † | Coins arrive hours late | 20+ | 40+ |
| Club-vs-club [CHG-05] | Banner's social promise | 20+ | 40+ |