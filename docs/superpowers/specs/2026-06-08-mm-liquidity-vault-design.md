# Tai MM Liquidity Vault — Design Spec

**Date:** 2026-06-08
**Status:** design / roadmap (NOT for the Sui Overflow deadline — the hackathon ships the verified capped-operator primitive; this is the product it points to).

## Goal

A **trust-minimized agentic market-making fund**: depositors (other Tai agents, or users) contribute SUI to a shared vault and receive transferable **shares**; a specialist **manager agent** deploys the pooled capital into DeepBook market-making and the realized P&L accrues to the vault, redeemable pro-rata. The manager earns a fee for running it.

## Why (the thesis we settled on)

Every agent half-running MM on its own fragmented treasury is worse than one specialist aggregating idle capital into a single professional strategy with one control surface. Specialization + control beats fragmentation. The objection — "that centralizes risk" — is real, and the whole point of this design is that **Tai's primitives bound that centralized risk instead of trusting it away.**

## The trust architecture (the crux)

Centralization is only dangerous if it's *custodial*. Here it isn't, on two enforced layers:

1. **The manager can trade the pool but cannot withdraw it.** DeepBook v3 BalanceManagers separate *trading* authority from *withdrawal* authority: the owner can mint a **TradeCap** that lets a delegate place/cancel orders, while **withdrawals remain owner-only**. So:
   - The **vault owns** the DeepBook BalanceManager.
   - The **manager agent holds only a TradeCap** → it can run the MM strategy but **physically cannot move funds out** to itself or anyone. Only the vault (governance) withdraws (for settlement / redemptions).
   - This eliminates the custody/rug risk of pooling capital into one manager. The scary failure mode is gone by construction.

2. **The rate of capital at risk is capped, and the manager is revocable.** Funds move from the safe **vault reserve** into the at-risk BalanceManager under a Tai **OperatorCap** (daily ceiling, allowlist, TTL) — so only a bounded fraction is exposed per epoch — and the manager's authority (TradeCap and/or OperatorCap) is **revocable on-chain in one tx** the instant it misbehaves. (This reuses the verified `operator_spend_sui_coin` + revocation path.)

Net: the manager gets the benefits of centralization (specialization, capital efficiency, one control surface) while depositors keep **non-custodial, rate-limited, revocable** exposure — enforced in Move, not promised.

## Share accounting + NAV strike (avoid marking live positions)

The hard part of any vault is valuing capital that's mid-strategy (resting orders + inventory). We sidestep live-marking with an **epoch settlement** model:

- The vault's value is struck **only at settlement points**, when the manager has **unwound** (cancelled resting orders; positions settled back to SUI in the BalanceManager). At a strike, vault NAV = `vault_reserve_SUI + balance_manager_SUI` — a clean, fully on-chain number, no oracle.
- **Deposits/withdrawals process at the most recent struck price.** Between strikes the manager runs MM; deposit/withdraw requests **queue** and clear at the next strike (standard fund behavior).
- Shares are a fungible `Coin<VAULT_SHARE>`:
  - deposit → `shares = amount × total_shares / NAV` (1:1 on the first deposit).
  - withdraw → `payout = shares × NAV / total_shares` (burn shares).

This keeps share price honest (it only updates against realized, on-balance value) at the cost of deposit/withdraw latency (one epoch) — an acceptable, well-understood tradeoff.

## Manager economics (ties to Tai's real revenue model)

The manager agent's income is **not** the trading P&L (that's the depositors'). It's a **management/performance fee** skimmed at settlement — routed through `record_service_payment_sui` so it grows the manager agent's **NAV and cred**. So the MM specialist is "paid for work," exactly Tai's proven revenue loop, and its reputation (cred) reflects real assets managed + performance. Depositors can pick managers by cred.

## Trust & risk boundaries (honest — what this does and does NOT protect)

- ✅ **Custody / rug** — solved (TradeCap = no withdrawal authority for the manager).
- ✅ **Exposure rate** — capped (OperatorCap daily ceiling on deploy).
- ✅ **Governance** — manager instantly revocable on-chain.
- ❌ **Strategy / market risk** — the manager can still *lose* money (adverse selection, bad fills); depositors bear that pro-rata. The cap bounds theft, not P&L.
- ❌ **Accounting correctness** — deposit/withdraw share math + NAV strike must be exact; bugs misallocate. Needs heavy testing + audit.
- ❌ **Contract risk** — new, unaudited Move module.
- ❌ **Settlement gaming** — manager could time strikes; mitigate with fixed cadence / keeper-triggered strikes. Open question.

## Move surface (new `tai::mm_vault` module, sketch)

- `create_vault<T>(...) -> (Vault, VaultOwnerCap)` — opens a vault + its DeepBook BalanceManager (vault-owned), mints the share-coin treasury.
- `deposit<T>(vault, payment: Coin<SUI>, ctx) -> Coin<VAULT_SHARE>` (or queues to next strike).
- `request_withdraw(vault, shares: Coin<VAULT_SHARE>)` → claimable after the next strike.
- `appoint_manager(vault, owner_cap, manager_addr, deploy_cap_params)` — issues the manager a DeepBook TradeCap + a Tai OperatorCap (capped deploy). 
- `revoke_manager(vault, owner_cap)` — revoke TradeCap + OperatorCap.
- `strike_nav(vault, ...)` — assert the BalanceManager has no open orders (unwound), compute NAV, settle queued deposits/withdrawals, skim the manager fee via `record_service_payment_sui`.
- Reuses: `operator_spend_sui_coin` (deploy reserve → BalanceManager, capped), DeepBook `place_limit_order` / `cancel` (manager via TradeCap), DeepBook owner-only `withdraw` (vault settlement).

## Off-chain: the manager runtime

The MM strategy loop (quote two sides around the mid, rebalance as price moves, unwind before strikes) runs off-chain via the TradeCap — same shape as `examples/deepbook-agent`, extended to two-sided quoting + a strike-aware unwind. (Two-sided quoting needs base+quote inventory; the vault funds both or the manager bootstraps inventory at open.)

## Out of scope / phasing

- **v1:** single vault, single manager, single DeepBook pool, fixed-cadence strikes, SUI-denominated.
- **Later:** multiple managers / strategies per vault, cred-weighted manager selection, multi-pool, performance-fee high-water-marks, keeper network for strikes.

## Honest caveats

- **No demonstrable yield on testnet** — a synthetic testnet book has no flow; realized returns are a mainnet/real-flow property. Demos show the *mechanism* (deposit → capped non-custodial deploy → strike → redeem → revoke), never an APR.
- **Mainnet-gated** — real depositor money in an unaudited vault is exactly what the audit gate exists for. This is post-audit.
- This is the product the hackathon's capped-operator primitive points to; the submission stays on the verified primitive + pitches this as the vision.

## Open questions

1. DeepBook v3 `deposit` authority — can a non-owner fund a vault-owned BalanceManager, or must the vault deposit? (Determines whether the manager self-funds under its OperatorCap or governance funds it.) Confirm against the SDK/contracts.
2. Strike trigger — fixed cadence vs. keeper-triggered vs. owner-triggered; anti-gaming.
3. Share-coin vs. position-NFT for ownership (fungible shares chosen for composability).
4. Fee model — flat management vs. performance + high-water-mark.
