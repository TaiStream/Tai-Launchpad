# Agent Standing & Reputation Signals — Design

**Date:** 2026-06-02
**Status:** approved direction (user chose "discovery/standing score, price untouched")

## Goal

A fundamentals-anchored **standing** score for discovery/ranking that blends
realized value (`NAV × cred`) with market commitment (pooled SUI), plus
transparent **reputation signals** (distinct payers, concentration, recency)
that the raw `cred` number can't express. All computed off-chain from reads we
already do. The on-chain hire price (`NAV × cred`) and the contract are
unchanged.

## Why (gaps this closes, and where)

From the reputation gap analysis:

- Market belief was entirely unused as a signal. (closed: market term)
- `cred` can't distinguish **breadth** (many payers) from **concentration**
  (one whale), and can't express **recency**. (closed: reputation signals)
- A one-payer self-dealing sybil is invisible. (closed: `singleSourceCred` flag)

These are all *discovery/display* concerns. Solving them off-chain is correct:
gaming a ranking only buys a misleading sort, not extracted money — so the
soft, manipulable market signal belongs here, not in the hire price.

## Standing (account-only — used on the card + gallery sort)

```
fundamentalSui = navSui × multBps / 10_000      // == hire price; realized, hard to game
marketSui      = pooledSui (real_sui)           // market capital actually committed
standingSui    = (wf·fundamentalSui + wm·marketSui) / (wf + wm)   // wf=60, wm=40
```

- **Market input is `real_sui` (pooled SUI), not MC.** This is the conservative,
  liquidity-aware choice: a thin pool contributes little, and there is no
  marginal-price × supply inflation to exploit. The liquidity floor is intrinsic
  — no separate floor constant needed.
- Fundamentals-weighted (60/40) so a market pump moves standing by at most its
  40% share, and reversibly, at fee cost.
- All values SUI (MIST), bigint math. No contract read beyond the account.

## Reputation signals (event-derived — agent page only)

From `ServicePaymentEvent`s where `countedTowardCred == true`:

- `distinctPayers` — distinct counted payer addresses
- `topPayerShareBps` — largest counted payer's share of counted revenue (0..10000)
- `lastPaidMs` — most recent counted payment timestamp (0 if none)
- `countedTotalSui` — sum of counted payments (from events)

Exact lifetime counted revenue comes from `account.lifetimeServiceRevenueSui`
(complete on-chain counter); the breakdown above is "from recent payments"
(the agent page already loads recent events — no extra RPC).

Flag:
- `singleSourceCred` — counted revenue > 0 but `distinctPayers ≤ 1`. The visible
  sybil/self-dealing tell.

## Surfaces

- **AgentCard:** add a **Standing** headline (SUI); keep NAV / Hire / Cred.
- **Gallery:** sort rows by `standingSui` desc (launch time as tiebreaker).
- **Agent page:** a "standing & reputation" panel — standing + fundamental/market
  split, distinct payers, concentration %, last active, and the `singleSourceCred`
  caution when it applies.

## Explicitly OUT of scope (needs a contract upgrade + real design — deferred)

- On-chain `cred` formula changes (distinct-payer weighting, time decay)
- Identity / sybil binding (SAI overlay)
- Quality/outcome adjudication; decentralized dispute resolution
- Negative reputation / slashing

These gate real hire money and must be brainstormed + upgraded deliberately,
not bolted on. Tracked as a separate "reputation hardening" track.

## Files

- Create: `app/src/lib/standing.ts` (pure) + `app/src/lib/standing.test.ts`
- Modify: `app/src/components/AgentCard.tsx`, `app/src/app/(dashboard)/agents/page.tsx`,
  `app/src/app/(dashboard)/agent/[id]/page.tsx`
