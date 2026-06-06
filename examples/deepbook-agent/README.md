# deepbook-agent — Autonomous Agent Wallet (Tai OperatorCap × DeepBook)

An AI agent that autonomously trades on **DeepBook** under a budget that is
**capped, scoped, expiring, and instantly revocable — enforced in Move** by its
Tai `OperatorCap`. This is the Agentic Web Sub-track 2 flow.

## Why Sui

The agent's spending authority is a **type-enforced Move object** (`OperatorCap`),
not an off-chain key policy. In a single atomic PTB the agent:

1. `tai::agent_treasury::operator_spend_sui_coin` → `Coin<SUI>` — Move enforces
   the daily ceiling, expiry, and active/revoked check, then hands back the coin.
2. `deepbook::balance_manager::deposit` — funds the agent's BalanceManager.
3. `placeLimitOrder` — a real DeepBook order.

If the owner revoked the cap, step 1 aborts and the whole transaction reverts —
the agent cannot trade. The ceiling is enforced by Move, not by the agent
behaving; compromise rotates a cap and the treasury stays safe.

## Sub-track 2 must-haves

| Must-have | How |
|---|---|
| real DeepBook orders | `placeLimitOrder` on a testnet pool |
| self-enforced budget ceiling | `OperatorCap.daily_limit_sui`, checked in Move every spend |
| on-chain activity log | `TreasuryWithdrawEvent` (Tai) + DeepBook order events |
| owner revocation demo | `revoke_operator_cap` (OwnerCap) → next spend aborts `EOperatorCapRevoked` |

## Status — verified end-to-end on testnet (2026-06-05)

Ran the full flow against live Sui + DeepBook testnet. The atomic strategy tx
`44tL2MyxuiyEcfx8hoPTKbpSQgXJK7kDrq7tEeAp3bCK` succeeded with these events:
`agent_treasury::TreasuryWithdrawEvent` (capped spend) → `balance_manager::BalanceEvent`
(deposit) → **`order_info::OrderPlaced`** (a real DeepBook order) — all in one PTB.
The four Sub-track 2 must-haves, each confirmed on-chain:

- **real DeepBook order** — `OrderPlaced` in tx `44tL2Myx…`
- **self-enforced budget ceiling** — `operator_spend_sui_coin`, daily cap enforced in Move
- **on-chain activity log** — the events above
- **owner revocation** — after `revoke_operator_cap`, the next trade aborted with
  `EOperatorCapRevoked` (tx `D9YPW6im…`)

Two things the dry-run pinned down (now baked into the defaults):

- **DeepBook package id must match the installed SDK's deployment.**
  `@mysten/deepbook-v3` 0.12.x bundles `@mysten/sui` 1.22.0 and targets DeepBook
  `0xcbf4748a…07f7e` on testnet (not the newest on-chain DeepBook). Pin
  `@mysten/sui` to 1.22.0 (done) so there's one `Transaction` type.
- **Use a DEEP reference pool to avoid needing DEEP for fees.** `SUI_DBUSDC` is
  non-whitelisted and aborts `place_order` without DEEP in the manager. `DEEP_SUI`
  (default) lets the agent fund with SUI and **bid** for DEEP, fees in SUI. min
  order 10 DEEP.

## One-command demo (`demo.sh`)

`./demo.sh` runs the whole story end-to-end on testnet and prints a Suiscan link
after every on-chain action — exactly the flow to screen-record:

> launch agent → grant a **scoped, revocable** OperatorCap budget → the agent
> places a **real DeepBook order in one atomic, capped tx** → owner **revokes** →
> the agent's next trade is **rejected on-chain**.

```bash
npm install
# a funded (>= 3 SUI) testnet key, bech32 form (sui keytool export --key-identity <addr>):
export OPERATOR_KEY=suiprivkey1…
./demo.sh check     # no-spend preflight: binaries, derived address, balance
./demo.sh           # the full demo
```

It makes the funded key the sole signer (sui + tai + the runner) and restores
your original tai config + active address on exit. Do one full run before
recording — each underlying step is verified on-chain (see below).

## Network — testnet (Sui Overflow)

Sui Overflow runs on **testnet**, and DeepBook v3 is fully live there (there was
an official DeepBook v3 testnet campaign for exactly this). "Real DeepBook
orders" means real on-chain testnet orders — no mainnet required. Testnet
DeepBook addresses (the SDK auto-loads these for `env: "testnet"`; the package
id is only needed for the low-level deposit moveCall, and is the default here):

- package `0xcbf4748a965d469ea3a36cf0ccc5743b96c2d0ae6dee0762ed3eca65fac07f7e`
  — the deployment `@mysten/deepbook-v3` 0.12.x targets. The SDK auto-loads its
  pools + coin types for `env: "testnet"`; this id is only needed for the
  low-level deposit moveCall, and is the runner's default.
- pools include `DEEP_SUI` (the demo default), `SUI_DBUSDC`, `DEEP_DBUSDC`

The agent funds with SUI and places a **bid** on `DEEP_SUI` (buys DEEP) — a DEEP
reference pool, so no DEEP is needed for fees. `SUI_DBUSDC` is non-whitelisted
and would require DEEP in the manager, so it isn't the default.

## Prerequisites

1. **Deploy the upgrade** that adds `operator_spend_sui_coin` (`sui client
   upgrade`, Owner/publisher key). Without it, use the no-upgrade fallback:
   the existing `operator_spend_sui` (transfer to an allowlisted trading
   address) in a 2-tx flow — same budget gates, not atomic.
2. An agent with a funded `AgentTreasury<T>` and an issued `OperatorCap<T>`
   (`tai op issue --daily-limit … --ttl-days …`).
3. Testnet SUI in the operator's wallet for gas.

## Run

```bash
npm install   # pins @mysten/sui 1.22.0 to match @mysten/deepbook-v3

# common env (SUI_PRIVATE_KEY is the bech32 `suiprivkey1…` from `sui keytool export`)
export SUI_PRIVATE_KEY=suiprivkey1… TAI_PACKAGE_ID=0xf6a55d1f…573b \
  AGENT_COIN_TYPE=0x…::your_coin::YOUR_COIN \
  AGENT_TREASURY_ID=0x… OPERATOR_CAP_ID=0x…

# one-time: create the agent's DeepBook BalanceManager, note its id from output
npm run start setup

# strategy tick: spend under the cap + place a real DeepBook order, atomic.
# DEEP_SUI pool + bid + DeepBook package all default to the verified testnet
# values, so you only add the BalanceManager id + budget:
BALANCE_MANAGER_ID=0x… BUDGET_MIST=1000000000 npm run start
```

## Revocation demo

```bash
# owner revokes the cap
tai op revoke --treasury $AGENT_TREASURY_ID --owner-cap $OWNER_CAP --cap $OPERATOR_CAP_ID
# the next strategy tick now reverts with EOperatorCapRevoked — the agent is
# cut off mid-strategy, on-chain, instantly.
npm run start
```

## Env vars

See `src/strategy.ts` `loadConfig()` — `TAI_PACKAGE_ID`, `AGENT_COIN_TYPE`,
`AGENT_TREASURY_ID`, `OPERATOR_CAP_ID`, `OPERATOR_PRIVATE_KEY_HEX`,
`DEEPBOOK_PACKAGE_ID`, `BALANCE_MANAGER_ID`, `DEEPBOOK_POOL_KEY`, `BUDGET_MIST`,
`ORDER_PRICE`, `ORDER_QUANTITY`, `ORDER_SIDE`, `SUI_RPC_URL`.
