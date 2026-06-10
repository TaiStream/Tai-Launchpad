# Tai Economic Flywheel — Roadmap / Vision

**Date:** 2026-06-10
**Status:** ROADMAP / vision capture. NOT being built for the Sui Overflow submission.
The submission ships the *proven primitive* (capped, revocable agent wallet trading
DeepBook — see `examples/deepbook-agent/`). This doc captures the business that
primitive points at, developed in design discussion. It is the "why this is a
company" narrative, and the post-submission / post-audit build target.

## Thesis (one line)

Autonomous, capped agent wallets are the product; DeepBook is the venue that makes
them economically *alive*. Without an earning venue an agent wallet is just a safe
spender — and a safe spender isn't worth tokenizing.

## The flywheel

```
TAI token
  → TAI/SUI pool on DeepBook
    → agents earn TAI through VERIFIED OFF-CHAIN WORK (lottery-distributed)
      → use the TAI as inventory to run TWO-SIDED MM on the pool
        → real demand seeded by REAL demo agents (Larry, etc.)
          → maker fees + NAV growth + cred
            → token value → better/more agents → tighter book → (repeat)
```

Every arrow maps to something Tai already has: the OperatorCap wallet (capped,
revocable), the NAV/cred loop ("paid for verified work"), and the DeepBook
integration proven in the demo. The swarm is N of these wallets; the MM vault
(`specs/2026-06-08-mm-liquidity-vault-design.md`) is the pooled version of the
same MM activity. This doc is the economic layer that ties them together.

## The four guardrails (each is a trap we explicitly designed against)

1. **Sybil-resistant work.** Distribution rewards *verified off-chain
   contribution* — costly to fake because real work needs real counterparties.
   The activity measure is a trusted/attested input for now (a centralization
   point to name honestly; decentralized attestation is later). **Never** reward
   "MM-ing TAI" with TAI — that's circular and trivially farmed.
2. **Capped emission.** The lottery airdrop is inflation. It must be on a
   capped schedule and graduate to organic fee revenue, or it's just printing.
3. **Verifiable lottery.** If a lottery distributes the rewards, use Sui native
   randomness (`sui::random` / drand-backed) so the draw is provably fair, not
   "the team picks winners."
4. **Demand is demonstrated, not claimed.** You don't conjure demand; you show
   it. Real demo agents doing real, repeatable work — ideally a trickle of
   genuine *third-party* revenue — are the proof. One agent earning from a real
   external payer beats ten you fund yourself. The airdrop seeds the *sell* side
   of the book; it does not create buyers. Profit waits on real demand.

## Market-structure honesty

- DeepBook v3 is a **spot CLOB** — no borrow, no margin, no perps, so **no true
  short**. An "ask" is selling inventory you hold, not a short.
- Two-sided MM (seed both TAI + SUI, quote bid + ask, rebalance to target
  inventory) is the right strategy and earns spread in either direction *while
  inventory stays balanced* — but trending markets cause adverse-selection
  inventory buildup, and you **cannot hedge it off on DeepBook**.
- So the reflexive long-TAI risk is **bounded by the OperatorCap ceiling**
  (limit each agent's exposure), not eliminated. Size the cap deliberately.
- Do **not** build a perp/lending market to enable real shorting — massive
  scope + contract risk, wrong move near a token launch.

## Profit paths (where DeepBook actually earns, honestly)

1. **Productive treasury** — an agent deploys a bounded slice of idle treasury
   into DeepBook MM/LP → fees → NAV growth → token value. "Treasuries that earn
   instead of idle."
2. **MM / execution as a service** — a specialist agent provides liquidity or
   executes for others and charges a fee → `record_service_payment_sui` → cred.
   Tai's proven "paid for work" loop, with DeepBook as the work. (This is the
   vault, pooled.)

Profit is strategy-, flow-, and capital-dependent. Testnet proves the
*mechanism*, never an APR. Pitch "bounded, revocable, productive agent capital,"
not "yield."

## Phasing

- **Now (submission):** demonstrate the mechanism on **testnet** — the capped
  agent wallet placing real DeepBook orders, the swarm, revocation. Pitch this
  flywheel as the roadmap.
- **Post-submission / post-audit (mainnet):** the live TAI token, the TAI/SUI
  pool, work-rewarded lottery distribution, agents two-sided-MM-ing the pool.
  Real money in market-bearing positions is exactly the audit gate.

## Open questions (gate a real build, not the submission)

1. How is off-chain work measured/attested without a centralization rug? (start
   trusted, path to attestation)
2. Emission schedule + cap, and the trigger to taper into organic fees.
3. Per-agent inventory cap sizing vs. expected book depth.
4. Securities/optics framing for a native token MM'd by native agents —
   transparency that it's bounded liquidity provision, not price support.
