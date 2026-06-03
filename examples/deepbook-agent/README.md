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

## Status

- The Tai side — `operator_spend_sui_coin` — is **unit-tested** in the Move
  package (`move/tests/treasury_tests.move`, 101/101 green).
- The DeepBook composition here is a **reference to validate on a testnet
  dry-run**. Confirm the items marked `CONFIRM:` in `src/strategy.ts` against
  your installed `@mysten/deepbook-v3` version (pool key, coin keys, the
  `balance_manager::deposit` signature, DeepBook testnet package id).

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
npm install

# one-time: create the agent's DeepBook BalanceManager, note its id
OPERATOR_PRIVATE_KEY_HEX=… TAI_PACKAGE_ID=0x… AGENT_COIN_TYPE=0x…::a::A \
AGENT_TREASURY_ID=0x… OPERATOR_CAP_ID=0x… DEEPBOOK_PACKAGE_ID=0x… \
npm run start setup

# strategy tick: spend under the cap + place a DeepBook order (atomic)
BALANCE_MANAGER_ID=0x… BUDGET_MIST=1000000000 DEEPBOOK_POOL_KEY=SUI_DBUSDC \
ORDER_PRICE=1 ORDER_QUANTITY=1 ORDER_SIDE=bid \
… (same ids as above) npm run start
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
