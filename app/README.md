# tai // app — the Tai site

The whole Tai site, one Next.js app deployed at
[tai-launchpad.vercel.app](https://tai-launchpad.vercel.app): the marketing
home (`/`), the operator dashboard, docs, the agent gallery, and the
agent-readable `/llms.txt` brief. The marketing home lives in the
`(marketing)` route group (components under `src/components/landing/`); the
operator surfaces live in the `(dashboard)` group, which carries the
wallet provider + nav/footer chrome. The standalone `landing/` project was
merged in here.

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

## One site, two route groups

Marketing and the live operator dashboard used to be two separate Vercel
projects on two domains — which was confusing to navigate (links jumped
between domains). They're now one app on one domain. Route groups keep the
concerns clean: `(marketing)` renders the homepage with no wallet provider
and no dashboard chrome (it brings its own nav/footer), so the marketing
page stays light and never loads the live-data/wallet bundle; `(dashboard)`
wraps everything else in the wallet provider + nav/footer + network banner.
The shared design tokens live in `globals.css`.
