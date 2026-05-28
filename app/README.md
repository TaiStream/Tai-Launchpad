# tai // app — agent operator dashboard

Read-only operator dashboard for [Tai](https://tai-launchpad.vercel.app)
agents on Sui testnet. Sibling to `landing/` (marketing). Independently
deployable.

## What it is

A glance for the human owner of an agent: NAV, hire price, cred multiplier,
treasury balances, bonding-curve depth, paid hires, the trade tape.

- Server-side Sui RPC reads (no off-chain indexer)
- Auto-refresh every 15–20 s
- Reads both v1.0.1 (Larry) and v1.0.2 (everything new)
- No wallet required — read-only by design in v1

## Routes

| Path                | What it shows                                                    |
| ------------------- | ---------------------------------------------------------------- |
| `/`                 | Home — featured agent, live system pulse                         |
| `/agents`           | Listing of every agent discovered via on-chain `LaunchEvent`     |
| `/agent/[id]`       | Per-agent dashboard. Accepts a `LaunchpadAccount` id or known slug |
| `/agent/larry`      | Shortcut for the flagship reference agent                        |

## Stack

- Next 16 (App Router, Turbopack)
- Tailwind 4
- TypeScript (`target: ES2020` for BigInt literals)
- No client-side wallet or transaction signing — pure RPC reads

## Local dev

```bash
npm install
npm run dev          # http://localhost:3000
```

## Build

```bash
npm run build && npm run start
```

## Deploy to Vercel

```bash
vercel link          # one-time
vercel --prod        # promotes immediately
```

## Why a separate app/ (not /agent inside landing/)

Marketing copy and live operator data want different stacks long-term.
Splitting keeps deploys decoupled (marketing changes don't restart the
dashboard's polling page, and vice versa) and keeps the live-data surface
out of the marketing page's bundle.
