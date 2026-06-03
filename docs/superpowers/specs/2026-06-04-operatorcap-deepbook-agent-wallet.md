# OperatorCap × DeepBook — Autonomous Agent Wallet

**Date:** 2026-06-04
**Status:** in progress — Move primitive built + tested; off-chain runner is a reference pending testnet validation.
**Hackathon:** Agentic Web → Sub-track 2 (Autonomous Agent Wallet).

## Goal

Let a Tai agent autonomously trade on **DeepBook** using a budget that is
**capped, scoped, expiring, and instantly revocable — all enforced in Move** by
its `OperatorCap`. This is both a real product capability (agents as
autonomous capital allocators) and the Agentic Web Sub-track 2 ask.

Sub-track 2 must-haves → how we meet them:
- **real DeepBook orders** → the runner places a real limit order on a DeepBook
  testnet pool.
- **self-enforced budget ceiling** → `OperatorCap.daily_limit_sui`, enforced in
  Move on every spend (with daily epoch reset).
- **on-chain activity log** → `TreasuryWithdrawEvent` (Tai) + DeepBook's own
  order events.
- **owner revocation demo** → `OwnerCap`-gated `revoke_operator_cap`; the next
  spend aborts with `EOperatorCapRevoked`.

The "why Sui" story: the agent's spending authority is a **type-enforced Move
object**, the ceiling is enforced by Move (not by the agent behaving), and the
spend + the DeepBook order settle **atomically in one PTB**. Compromise rotates
a cap; the treasury stays safe.

## The hinge (why a new Move function)

The existing `operator_spend_sui` **transfers** to an allowlisted address — it
does not return a `Coin`, so it cannot compose with a DeepBook order in one
atomic PTB. Two architectures follow:

- **A — existing `operator_spend_sui` (no upgrade, 2 transactions).** Tx1: spend
  to the agent's allowlisted trading address. Tx2: deposit + place order.
  Enforces ceiling + expiry + revocation **and destination** (allowlist). Runs
  against the live v1.1.2 contract today. Not atomic.
- **B — new `operator_spend_sui_coin` (one atomic PTB; needs an upgrade).**
  Returns the `Coin<SUI>` so a single PTB spends under the cap and feeds the
  coin straight into a DeepBook deposit + order. Enforces ceiling + expiry +
  revocation; destination is decided by the PTB (no on-chain allowlist on this
  path — that is the composability/enforcement trade-off, documented in the
  function). Strongest "why Sui" story.

We build **B** as the primary (it's the differentiated, atomic version) and keep
**A** as the no-upgrade fallback that already works.

## Built + tested (this pass)

`move/sources/agent_treasury.move` — `operator_spend_sui_coin<T>(treasury,
op_cap, amount, clock, ctx): Coin<SUI>`. Same budget gates as
`operator_spend_sui` (cap matches treasury, active/not-revoked, not expired,
daily ceiling with epoch reset), returns the coin instead of transferring.
Emits `TreasuryWithdrawEvent`.

`move/tests/treasury_tests.move` — 4 tests, all green (101/101 total):
- `operator_spend_coin_within_limit_returns_capped_coin`
- `operator_spend_coin_exceeding_limit_aborts` (EOperatorDailyLimitExceeded)
- `operator_spend_coin_after_revocation_aborts` (EOperatorCapRevoked)
- `operator_spend_coin_after_expiry_aborts` (EOperatorCapExpired)

Adding a public function is an **upgrade-compatible** change (additive; no struct
or existing-signature changes), so it ships via the same in-place
`sui client upgrade` flow as v1.1.2.

## Off-chain runner (reference — `examples/deepbook-agent/`)

A TS strategy-runner that, in one PTB:
1. `operator_spend_sui_coin(treasury, op_cap, dailyBudget, clock)` → `Coin<SUI>`
2. `deepbook::balance_manager::deposit` the coin into the agent's BalanceManager
3. DeepBook SDK `placeLimitOrder({ poolKey, balanceManagerKey, price, quantity,
   isBid, payWithDeep })`

Plus a `--revoke` mode: owner calls `revoke_operator_cap`, then the runner
attempts a spend and shows it abort. Logs every tx digest + the emitted events.

DeepBook integration uses `@mysten/deepbook-v3` (`DeepBookClient`,
`createAndShareBalanceManager`, `placeLimitOrder`). The deposit of the
Tai-returned coin is a lower-level `tx.moveCall` into DeepBook's
`balance_manager::deposit` (the SDK's `depositIntoManager` does its own coin
selection and won't accept our composed coin).

## Validation gates (need the user — keys/testnet)

1. **Deploy the upgrade** (`sui client upgrade`) so `operator_spend_sui_coin` is
   live — requires the Owner/publisher key. (Path A needs no upgrade.)
2. **Testnet dry-run** of the runner from a funded wallet + an agent that holds
   an `OperatorCap`: confirm the DeepBook pool key, coin keys, BalanceManager
   creation, and the deposit moveCall signature against the installed
   `@mysten/deepbook-v3` version.
3. The Tai side (the Move primitive) is unit-tested; the DeepBook composition is
   the part to validate on testnet.

## Out of scope (deferred)

- Full Move-wrapped DeepBook (Tai Move fn that calls DeepBook directly with a
  DeepBook Move dependency) — airtight on-chain "DeepBook only" scope, but a
  heavier dependency. Not needed for the must-haves.
- `operator_spend_token_coin` (token-denominated composable spend) — trivial
  mirror, add if a strategy needs to spend the agent's own coin.
- Strategy sophistication — the demo uses a single resting limit order; real
  market-making/rebalancing is future work.
