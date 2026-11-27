# PRD: Hexabout Leagues (MVP, 12 weeks)

## 1. Core loop
Play a match → winner sees +1 at once, confirmed in seconds → climb a weekly league of 50 → at reset, the top move up a tier with coins, the bottom down.

## 2. Scope (MoSCoW)
| | Item |
|---|---|
| **Must** | Minimum app version; join a same-tier league of 50 on first weekly match |
| **Must** | +1 per win, no draws, ties to the first to reach it; leaderboard: optimistic update, polling sync, disputes greyed out |
| **Must** | Weekly reset: points → 0, tier stays; a match counts in its first report's week if confirmed before close |
| **Must** | 5 named tiers, promotion/demotion zones, ≥ 5 wins to promote; coins on promotion only, once [CHG-06] |
| **Must** | Anti-cheat and payout safety: dual report, rate limits, absolute weekly cap (A2) below leagues × promoted × coins, manual weekly approval, kill switch [CHG-06] |
| **Must** | Launch build: server-set polls, Retry-After, jittered backoff, retry queue; Leagues and coin switches (fixed date; ROADMAP gates) [CHG-04] |
| **Should** | Admin preview/approve endpoints (SQL until then) [CHG-06] |
| **Could** | One-report matches: human review [CHG-04] |
| **Won't** | All of §6, skill matchmaking, match server |

## 3. Non-goals
Gameplay changes, coin budget system, perfect anti-cheat.

## 4. Assumptions
| # | Assumption | From |
|---|---|---|
| A1 | Both phones know the result; only phones store it [CHG-01] | Q1 |
| A2 | No limit given; we propose an absolute weekly cap; the owner sets it [CHG-01] | Q2 |
| A3 | <$500/month normal, $2,000 launch week; dedicated vCPU [CHG-01] | Q3, CR |
| A4 | Launch: 10× DAU (600k), mostly new, peak hour 1; weekly members unknown (CAPACITY §7); later pushes 5× (seen: 3×/2 days) [CHG-01] | Q4, CR |
| A5 | Players cheat; coins after week close + approval [CHG-01] | Q5 |
| A6–8 | Configurable reset time; inactive players keep tier; leagues fill first-come-first-served | Decision |
| A9 | Wallet ignores repeated payment keys; else manual review | Open |
| A10 | Login issues a signed JWT; Leagues verifies it locally | Open |

## 5. Questions
Q1–5 answered 2026-11-23; CR = CHANGE-RESPONSE.md. None left: A9, A10 go to wallet and login teams (ROADMAP W1). [CHG-01]

## 6. Cuts and what each costs
Days with AI (estimates). † = platform project.

| Cut | Product cost | Days |
|---|---|---|
| Global rank | PO-requested motivator | 4 |
| Friends + their leagues | Less social retention | 12 |
| Challenges | Less virality; enables win trading | 12 |
| WebSockets † | Few-second lag | 15 |
| Local-midnight reset † | Some regions reset in daytime | 20 |
| Instant rewards † | Coins arrive hours late | 20+ |
| Club-vs-club [CHG-05] | Banner's social promise | 20+ |