# DeepBook v3 Move integration — spike findings (MM vault Task 0)

## 0.1 — TradeCap cannot withdraw — VERIFIED (GO)

Source: `MystenLabs/deepbookv3` `packages/deepbook/sources/balance_manager.move`.

- `withdraw<T>` and `withdraw_all<T>` both call `generate_proof_as_owner(balance_manager, ctx)`, which runs `validate_owner(ctx)` → asserts `ctx.sender() == balance_manager.owner()`. **Withdrawal is owner-only.**
- `mint_trade_cap` mints a `TradeCap` validated by `validate_trader` (membership in the `allow_listed` set). A TradeCap authorizes **trading only** (`generate_proof_as_trader`); it is never accepted by `withdraw`/`withdraw_all`.
- Bottom line: **a TradeCap holder cannot withdraw.** The vault-owns-BalanceManager + manager-holds-trade-only-TradeCap design is sound: the manager physically cannot move the pool out.

Caveat (unchanged from the spec): a TradeCap *can* trade, so a malicious manager can still bleed value via adversarial fills (sell cheap to a wallet it controls). This is why orders must be **mediated + price-band-checked** by the vault (the manager never holds the raw TradeCap; it calls `vault::manager_place_order`). The withdrawal-block + price-band + rate-cap + revocation together bound the risk; nothing alone makes it rug-proof.

## 0.2 — Tai can depend on deepbookv3 — VERIFIED (FEASIBLE)

Empirically confirmed: added the dep to `move/Move.toml`, `sui move build` succeeded, and **all 108 existing Tai tests still pass** after the required framework-rev bump. Two gotchas, both resolved:

1. **Framework-rev conflict.** deepbook (via its `token` dep) pins `MoveStdlib` at rev `9a4d4016ba66c646c76c4b8d54fa9e767f240ab1`; Tai was on `95cddc3f5` → `conflicting versions of package MoveStdlib`. Fix: bump Tai's `Sui` dep to deepbook's rev. The 108/108 pass confirms the bump didn't break any Tai module.
2. **Dep key must equal the package name.** `DeepBook = {...}` errors (`Name of dependency 'DeepBook' does not match dependency's package name 'deepbook'`). Use lowercase `deepbook`.

Exact working stanza (re-apply at Task 4 — currently **reverted** out of the committed manifest since no vault code uses deepbook yet):
```toml
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "9a4d4016ba66c646c76c4b8d54fa9e767f240ab1" }
deepbook = { git = "https://github.com/MystenLabs/deepbookv3.git", subdir = "packages/deepbook", rev = "main" }
```
deepbook's own `Move.toml` sets `deepbook = "0x0"` (resolved at publish/call; testnet deployment the SDK uses is `0xcbf4748a…07f7e`). **Caveat:** the rev bump changes Tai's framework rev vs the deployed v1.1.3 (built on `95cddc3f5`) — re-verify Sui upgrade-compat before deploying any vault upgrade. The on-chain framework is the network's system package, so this should be compat, but verify.

## 0.4 — order-band reference price — DECIDED

**Pyth on Sui** as the band reference, with a **pool-mid sanity cross-check** (reject if Pyth and the DeepBook mid diverge beyond a wide bound, to catch a stale/garbage oracle). Rationale: the pool mid alone is manipulable on a thin book — a manager could move the mid then trade against it inside the band. Pyth is harder to manipulate; the cross-check bounds Pyth's own failure modes. Adds a Pyth dependency (acceptable). Needed at Task 4 (`manager_place_order`).

## 0.3 — exact DeepBook call signatures — deferred to Task 4

The vault needs: create+share BalanceManager, `mint_trade_cap`, `generate_proof_as_owner`, `deposit`, `withdraw`, `place_limit_order`, `cancel_order`, open-orders query (unwound assertion at strike). These will be read straight from the now-resolvable `deepbook` source at Task 4 implementation time (the dep builds, so the modules are in hand). Not gating — feasibility (0.1, 0.2) and the design decision (0.4) are the items that had to clear first.

## Spike verdict: GREEN

0.1 (TradeCap can't withdraw) and 0.2 (Tai↔deepbook build) both clear; 0.4 decided. The on-chain-mediated, bounded-custody design is feasible. Proceed to Tasks 4–7.
