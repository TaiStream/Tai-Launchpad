# Tai MM Liquidity Vault — Design Spec

**Date:** 2026-06-08 (revised after a critical self-review — the v1 draft overstated custody safety; corrected below).
**Status:** design / roadmap (NOT for the Sui Overflow deadline — the hackathon ships the verified capped-operator primitive; this is the product it points to). Mainnet/post-audit.

## Goal

A **rate-bounded, revocable agentic market-making fund**: depositors (other Tai agents, or users) contribute SUI to a shared vault and receive transferable **shares**; a specialist **manager agent** runs a DeepBook MM strategy over the pooled capital; realized P&L accrues to the vault, redeemable pro-rata; the manager earns a fee.

## Why (the thesis)

One specialist aggregating idle capital into a single professional strategy with one control surface beats every agent half-running MM on its own fragmented treasury. Specialization + control beats fragmentation. The objection — "that centralizes risk" — is real, and the job of this design is to **bound and govern** that risk with Tai's primitives. Note up front (this is the honest correction from review): it **bounds** the risk; it does not **eliminate** it.

## Trust architecture — bounded custody, NOT non-custodial

Three layers. What each actually does (and does not):

1. **The vault owns the funds; the manager never holds raw spend/withdraw power.** The vault owns the DeepBook BalanceManager; only the vault (governance) can `withdraw`. The manager is an *appointed role*, not the holder of a raw TradeCap. *Load-bearing assumption to verify before building:* DeepBook v3's TradeCap is withdrawal-incapable — unconfirmed against the contracts; the whole separation depends on it.

2. **A trade-only manager can still BLEED the pool — so orders are mediated and price-bounded.** Withdrawal-blocking is necessary but NOT sufficient: a manager that can trade can sell the pool's inventory at a garbage price to a wallet it controls, draining value through a *trade* (self-match prevention doesn't help — different BalanceManager). To stop this, **the vault holds the TradeCap and the manager places/cancels orders only through vault functions that enforce a price-sanity bound** (reject any order whose price deviates more than X% from a reference). The manager gets a *bounded order path*, never the raw cap. This is the v1-critical mitigation the first draft was missing.

3. **Exposure is rate-capped and the manager is instantly revocable.** Capital moves from the safe vault reserve into the at-risk BalanceManager under a Tai **OperatorCap** (daily ceiling, allowlist, TTL), so only a bounded fraction is exposed per epoch; the manager role is **revocable on-chain in one tx**. This bounds the blast radius: worst case is the deployed fraction, until revocation.

**Honest net:** depositors get **withdrawal-blocked, price-bounded, rate-limited, revocable** exposure — much stronger than a trusted vault, but **not rug-proof**. The *deployed* capital can still be lost to a malicious manager (orders at the edge of the price band, repeated) or an incompetent one (bad MM) up to revocation. The cap bounds how much and how fast; price-bounds + revocation bound the rest. Calling it "non-custodial" was wrong; "bounded custody" is the truth.

## Share accounting + NAV strike

Avoid valuing live positions via an **epoch settlement**:

- NAV is struck **only at settlement**, after the manager has **unwound** (orders cancelled, inventory liquidated to SUI). Then NAV = `vault_reserve_SUI + balance_manager_SUI` — clean and on-chain.
- Deposits/withdrawals **queue and clear at the next struck price**.
- Shares are `Coin<VAULT_SHARE>`: deposit → `amount × total_shares / NAV`; withdraw → `shares × NAV / total_shares`.

**Required guards (from review):**
- **First-deposit inflation attack:** a naive `1:1 first deposit` is exploitable (mint 1 share, donate to inflate, next depositor rounds to 0). Mitigate with permanent **dead-shares** (seed a tiny supply to a burn address) or a **virtual-offset** in the price math. Required.
- **Strike-timing dilution / sandwiching:** clearing at a predictable struck price invites timing games. Mitigate with per-depositor entry/exit accounting and/or randomized/keeper-triggered strike times.
- **Inventory at strike:** "clean SUI NAV" assumes *full* liquidation. Residual non-SUI inventory must be valued (→ a price reference / oracle) or liquidation must be enforced; thin-book liquidation carries slippage. The "no oracle" property only holds if full liquidation is guaranteed.

## Manager economics (ties to Tai's revenue loop)

The manager's income is a **management/performance fee** skimmed at settlement, routed through `record_service_payment_sui` → grows the manager agent's NAV and **cred**. So the specialist is "paid for work" (Tai's proven loop) and depositors can rank managers by cred. *Caveat:* the fee only counts toward cred if the payer ≠ the manager's creator (self-payments are excluded) — so the vault/fee routing must not be a self-pay, or cred won't accrue.

## Risk boundaries (honest — what's protected vs. not)

- ⚠️ **Custody / rug** — REDUCED + rate-bounded + revocable, **not eliminated**. Withdrawal is blocked and orders are price-bounded, but a malicious manager can still bleed the *deployed* fraction within the band, up to revocation. (And the TradeCap withdrawal restriction is unverified.)
- ✅ **Exposure rate** — capped (OperatorCap bounds the deployed fraction per epoch).
- ✅ **Governance** — manager instantly revocable on-chain.
- ⚠️ **Liveness / redemptions** — a manager that won't unwind can freeze strikes and exits. Requires an owner/keeper **force-unwind** path (cancel all orders + withdraw) so depositors can always exit.
- ❌ **Strategy / market risk** — the manager can lose money (adverse selection, bad fills); depositors bear it pro-rata, bounded by the deployed fraction.
- ⚠️ **NAV valuation** — see inventory-at-strike above.
- ⚠️ **Share-math attacks** — first-depositor inflation + strike-timing dilution (mitigations above).
- ❌ **Contract risk** — new, unaudited Move module.

## Move surface (`tai::mm_vault`, sketch)

- `create_vault<T>(...) -> (Vault, VaultOwnerCap)` — opens vault + a vault-owned DeepBook BalanceManager + dead-shares seed + the share-coin treasury.
- `deposit(vault, Coin<SUI>)` → queued; `claim_shares(...)` after a strike. `request_withdraw(vault, Coin<VAULT_SHARE>)` → claimable after a strike.
- `appoint_manager(vault, owner_cap, manager_addr, price_band_bps, deploy_cap_params)` / `revoke_manager(vault, owner_cap)`.
- `manager_place_order(vault, manager_proof, price, qty, side, reference)` — **asserts price within `price_band_bps` of `reference`**, then places via the vault-held TradeCap. `manager_cancel(...)`.
- `deploy(vault, op_cap, amount)` — reserve → BalanceManager, capped (reuses `operator_spend_sui_coin`). `force_unwind(vault, owner_cap)` — governance cancels all + pulls to reserve.
- `strike_nav(vault, ...)` — assert unwound, compute NAV, settle the deposit/withdraw queues at the struck price, skim the fee.

## Off-chain: manager runtime

The MM loop (quote two sides around the mid, rebalance, unwind before strikes) runs off-chain, calling `manager_place_order`/`manager_cancel`. Same shape as `examples/deepbook-agent`, extended to two-sided quoting + strike-aware unwind. **Unsolved dependency:** two-sided quoting needs base+quote inventory; acquiring the non-SUI side (the issue the single-agent demo hit) is a real cost/step, not free.

## Out of scope / phasing

- **v1:** single vault, single manager, one pool, fixed-cadence strikes, SUI-denominated, full-liquidation strikes, dead-shares guard, mediated price-bounded orders.
- **Later:** multiple managers/strategies, cred-weighted manager selection, multi-pool, performance high-water-marks, keeper network, partial-liquidation NAV with an oracle.

## Honest caveats

- **No demonstrable yield on testnet** — synthetic book, no flow. Demos show the *mechanism* (deposit → bounded deploy → strike → redeem → revoke), never an APR.
- **Mainnet-gated, post-audit** — real depositor money in an unaudited, market-risk-bearing vault is exactly the audit gate.
- The hackathon ships the verified capped-operator primitive and pitches this as the vision (honestly: "bounded, revocable delegated MM," not "rug-proof yield").

## Open questions (the ones that actually gate a build)

1. **Verify DeepBook v3 TradeCap cannot withdraw** — load-bearing for the entire separation. Confirm against the contracts before anything else.
2. **Reference price for the order band** — DeepBook pool mid (manipulable on a thin book), an external oracle (Pyth on Sui — dependency + its own trust), or a reference pool? The band is only as good as the reference.
3. **Strike trigger** — fixed cadence vs. keeper vs. owner; anti-gaming + guaranteed liveness (force-unwind).
4. **Full-liquidation enforcement vs. inventory valuation** at strike (determines whether an oracle is needed at all).
5. **Fee model** — flat vs. performance + high-water-mark; and routing so it counts toward the manager's cred (non-self-pay).
