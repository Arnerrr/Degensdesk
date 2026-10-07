# Degensdesk

A memecoin risk scanner. Paste a token address and Degensdesk queries several scanners at once, then combines the results into one report:

- **Rug signals.** Checks whether mint and freeze authority are revoked, whether metadata can still change, whether the token is a honeypot, its buy/sell tax, and whether its liquidity is unlocked.
- **Dev holdings.** Shows how much of the supply the creator or owner wallet holds, and flags linked insider wallets.
- **Holder concentration.** Shows what the top 10 wallets hold, excluding pools and lockers, and flags single whales.
- **Market health.** Shows liquidity, liquidity compared with market cap, token age, and whether a website or socials are listed.

It also has a **Fresh launches** feed of the newest tokens on DexScreener, each one auto-scanned.

> Not financial advice. A clean scan means none of the checks found anything. It does not mean the token is safe.

## Sources

| Source | Chains | Used for |
| --- | --- | --- |
| [DexScreener](https://docs.dexscreener.com/api/reference) | all | price, liquidity, market cap, age, socials, new-token feed |
| [RugCheck](https://api.rugcheck.xyz/swagger/index.html) | Solana | authorities, top holders and insiders, creator balance, LP lock, rug status |
| [GoPlus Security](https://docs.gopluslabs.io/) | Solana, Ethereum, Base, BSC | authorities, honeypot, taxes, holders, LP lock, owner privileges |

All three are free public APIs, so no keys are needed. A GoPlus access token is optional and raises its rate limits. If one source fails, the scan still runs on the others, and the report says which sources were unavailable. If no security source answers, the verdict is `unknown`, not a falsely reassuring score.

## Getting started

Requires Node.js 20 or later.

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # same, with auto-reload
```

Command-line scan:

```bash
npm run scan -- <token address>                     # chain auto-detected (0x… → ethereum)
npm run scan -- 0x… --chain base
npm run scan -- <address> --json                    # full report as JSON
```

Configuration (environment variables, see `.env.example`): `PORT`, `CACHE_TTL_SECONDS`, `GOPLUS_ACCESS_TOKEN`.

## API

- `GET /api/scan?address=<addr>&chain=<solana|ethereum|base|bsc>`: returns a `TokenReport` (see `src/types.ts`). `chain` is optional.
- `GET /api/feed`: the newest DexScreener token profiles, each scanned.
- `GET /api/health`

## How the score works

Each finding has a severity. A **danger** finding adds 25 points, a **warn** finding adds 10, and an **info** finding adds nothing. The total is capped at 100. A token that is a honeypot, or that has already been marked as rugged, is pinned to 100. The verdict is based on the score: **low** below 20, **medium** below 45, **high** below 70, and **extreme** from 70 up. When sources disagree, the worse value wins. For example, the highest reported dev holding is used, and the lowest reported LP lock is used. All thresholds are in `THRESHOLDS` in `src/analysis/analyze.ts`.

## Project layout

```
src/
  sources/        one adapter per API → normalised SourceSignals
  analysis/       merges signals, derives flags, scores
  scanner.ts      runs sources in parallel with caching
  server/         HTTP server (API + static UI)
  cli.ts          command-line scanner
public/           web UI (vanilla JS)
test/             parser and scoring tests (vitest)
```

## Development

```bash
npm test
npm run typecheck
```

## Roadmap

- Trading: wallet connect and swaps through Jupiter (Solana) or 0x/1inch (EVM)
- Watchlists and alerts when a token's risk changes (dev sells, LP pulled)
- Deeper dev history: previous launches and rugs by the same creator wallet
- More sources (e.g. Birdeye, Solscan, Honeypot.is, Token Sniffer)
