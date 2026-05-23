# Tai Design Spec

**Tai = Tokenized Agentic Infrastructure.** The Sui-native asset, treasury, and capability layer for AI agents.

**Status:** v1 design, locked, ready for implementation
**Author:** brainstormed with Claude (Opus 4.7), May 2026; revised May 2026 to drop the SAI hard-dependency, add object-bound custody (`AgentTreasury<T>` + `OwnerCap` / `OperatorCap`), reserve the linkage field for Ika cross-chain custody (v1.1 adapter), and reframe the primary access surface around a Rust CLI rather than a web UI.
**Depends on:** Sui framework only. SAI and Ika integrations live in separate adapter packages.

---

## 1. Overview

Tai is an asset-issuance, treasury-accumulation, and capability-gated custody layer for AI agents on Sui. Any creator with a fresh `TreasuryCap<T>` can launch a creator coin under Tai's bonding-curve AMM. The coin is the hire ticket, the access pass, and the revenue claim for an agent's actual on-chain economy. The agent itself can own its on-chain property through a sibling `AgentTreasury<T>` object whose withdrawals are gated by a two-tier capability system: an `OwnerCap<T>` for sovereign actions and scoped `OperatorCap<T>`s for daily operations.

The launchpad **is the pool.** Trades execute against the per-agent `LaunchpadAccount`'s own balances using constant-product math with virtual reserves.

The launchpad **also accumulates operating revenue.** When an agent earns SUI (or its own token) from a paid hire, the runtime records that payment. A configurable share flows into the agent's NAV. NAV is the productive treasury — non-withdrawable, backs the hire-price view.

The agent **holds its own working capital** in `AgentTreasury<T>`. Withdrawals are `OwnerCap`-gated; daily ops are `OperatorCap`-gated with Move-enforced spend limits, allowlists, and TTL. When agent ownership transfers, the OwnerCap transfers with it and the entire treasury follows atomically.

Tai's **primary access surface is `tai-cli`** — a single Rust binary that wraps every Move call. The CLI is the canonical interface for agent runtimes (any language, any platform, including TEEs). A WASM-backed TypeScript SDK and a web demo are derivatives, not the canonical surface.

Tai does not own identity. A `LaunchpadAccount` carries an `Option<ID>` field linking to whatever identity primitive the creator opts into (SAI, Walrus blob, ENS, anything). It also reserves a separate `Option<ID>` field for the v1.1 cross-chain custody adapter (Ika dWallets).

---

## 2. Goals and non-goals

### Goals

1. **Two-transaction atomic launch.** Tx 1: publish a one-time-witness coin module. Tx 2: a single PTB that consumes the `TreasuryCap`, creates the `LaunchpadAccount`, creates the `AgentTreasury` with a fresh `OwnerCap`, optionally issues an `OperatorCap`, and optionally chains a self-buy. The CLI bundles both txs behind one `tai launch` invocation.
2. **Zero seed capital.** Virtual reserves shape the curve mathematically. First buyer funds the pool.
3. **NAV grows from BOTH trading AND work.** Trade fees and recorded service payments both flow to `nav_sui`.
4. **The coin is productive.** Optional per-agent modes: token-gated hire (`access_threshold`), coin-denominated hire payments (`accept_coin_payments`). The token has utility beyond speculation.
5. **The agent owns its own property.** Sibling `AgentTreasury<T>` holds arbitrary `Coin<X>` and (via dynamic fields) other Sui objects. `OwnerCap` for sovereign actions; `OperatorCap` for daily ops with on-chain policy (spend limits, allowlists, TTL).
6. **Identity portability.** OwnerCap is `key + store` (transferable). Transferring the OwnerCap effectively transfers ownership of the agent and its entire treasury atomically. No registry update needed.
7. **Self-referential cred.** The hire-price multiplier derives from the agent's own lifetime service revenue.
8. **Agent-native primary access surface.** `tai-cli` is the canonical interface: language-agnostic, scriptable, LLM-friendly, single static binary, TEE-friendly. Three signing modes built in: local Ed25519, sui-keystore inheritance, and TEE-attested signing via Phala Cloud + Mysten Nautilus.
9. **Forward-compatible with cross-chain custody.** `LaunchpadAccount.dwallets_object_id: Option<ID>` reserves the linkage for the v1.1 Ika adapter (BTC / ETH / Solana agent treasuries via dWallets). v1 ships Sui-only; v1.1 turns this on without breaking the v1 object layout.
10. **Framework-agnostic, identity-agnostic.** Any agent runtime (Eliza, Virtuals, 01 Pilot, custom) can launch via CLI. Identity systems integrate via the optional adapter pattern.
11. **Flat, simple, generous fee splits.**
    - Trade fees: 30 NAV / 60 creator / 10 platform.
    - SUI service-payment fees: 40 NAV / 50 creator / 10 platform.
    - Token service-payment fees: 40 NAV-in-T / 50 burn / 10 creator.

### Non-goals (v1)

- SAI hard-dependency. SAI integration is a separate adapter package.
- Ika cross-chain custody. Deferred to v1.1 via `Tai-Ika-Adapter` package; the linkage field is reserved on the launchpad account.
- On-chain Cetus mirror or migration (v1.5).
- DeepBook integration (v2).
- Holder revenue distribution claim flow (v1.5; the revenue accumulation plumbing ships in v1).
- Capability lending between agents.
- Sub-agent ownership and parent-child revenue splits (v2). v1 supports spawned-by-agent launches through normal flows; on-chain parent-child accounting is v2.
- Collateralization adapters (NAVI, Suilend) (v2).
- Kiosk-based agent secondary marketplace (v2). NFTs held in the treasury use dynamic fields in v1.
- USDC-denominated bonding curves (v1.5).
- Graduation event / LP release (v1.5).
- One-transaction launch (v1.5 via on-client bytecode templating + same-PTB publish chaining).
- On-chain hire-flow object with escrow / completion attestation (v2).
- Cred decay (v1.5).
- A web-app-first user experience. The web demo exists for explorability and hire discovery, not as the primary creator interface.

If a primitive is not listed in §4 (Object Model) or §5 (Mechanism), it is out of scope. Do not invent.

---

## 3. Background

### Why Tai exists

Bags.fm on Solana gives end-creators ~25% of trade fees. Pump.fun gives end-creators nothing on the curve. Neither pays the agent's treasury for actual work the agent does. No Sui-native launchpad ships programmatic fee redirect, an on-chain treasury that grows from both trading and operating revenue, a productive-token model, AND object-bound agent custody under one roof. Tai fills that gap.

### Why Sui

- Object model fits agent-as-asset naturally; assets can be owned by other objects, enabling `AgentTreasury<T>` as the agent's bank account.
- Capability pattern (`Cap` objects with `key + store`) makes transferable, scoped permissions cheap and idiomatic.
- Move resource semantics prevent token-duplication bugs.
- zkLogin, Passkeys, multisig, and sponsored transactions are all in the protocol — covers the human bootstrap path.
- PTBs let us atomically launch, create treasury, mint caps, and self-buy in one tx.

### Why object-bound custody for agent property

A naive Sui wallet (Ed25519 keypair) for an agent has serious failure modes: key compromise = total loss; assets follow the operator key, not the agent identity; no on-chain spending policy; rotation requires full re-keying. None of these are acceptable for an autonomous agent that owns property.

Sui is the only chain where object-bound custody is native. We use it: `AgentTreasury<T>` is a Sui object that holds the agent's working capital. The `OwnerCap` is itself a transferable object. The agent's "bank account" follows the agent identity. The `OperatorCap` expresses spending policy in Move, where Cetus pools, NAVI markets, and future Tai-SAI / Tai-Ika adapters can read and trust it.

### Why no SAI hard-dep in v1

SAI is testnet-only as of May 2026. Coupling Tai to SAI blocks Tai from shipping until SAI matures. Better: keep them orthogonal. SAI is the *identity* overlay; Tai is the *asset + treasury* layer. They compose through a separate adapter package when both are mature.

### Why Ika is reserved for v1.1, not v1

Ika mainnet launched July 2025, expanded EdDSA support December 2025, and is production. Its `DWalletCap` has `key + store` and composes naturally with Tai's `AgentTreasury<T>` pattern — adding a `dwallets: vector<DWalletCap>` field (or dynamic-field map keyed by chain id) is straightforward. But v1 is already large. We ship Tai v1 Sui-only and reserve one field — `dwallets_object_id: Option<ID>` — to enable a clean v1.1 adapter without breaking the v1 object layout.

### Why a CLI is the primary access surface

Agents run inside processes. They invoke subprocess commands trivially. A CLI is language-agnostic (Python, Rust, Go, Bun, shell), TEE-friendly (single static binary), composable in pipelines (shell, cron, Docker entrypoints), LLM-friendly to generate (LLMs are vastly better at producing correct shell commands than typed TS), and avoids SDK version hell. Every serious chain ships one (`sui client`, `forge`, `solana`, `near`). Tai does too.

The TypeScript SDK wraps the same `tai-core` Rust crate via WASM. The web demo wraps the SDK. The canonical interface is the CLI.

### Why service-revenue-as-cred

Real money paid for real work is a strictly stronger quality signal than feedback votes. Tai's hire-price multiplier uses lifetime SUI service revenue directly. SAI's cred can layer multiplicatively later, but Tai never depends on it.

---

## 4. Object model

All structs live in this launchpad package. Field names are stable; the CLI, SDK, and any indexer depend on them.

### 4.1 `LaunchpadConfig` (shared, one per deploy)

Global configuration owned by the launchpad admin. Mutable by admin only. **No mutable counters** — global aggregates are recoverable from event indexers, which lets every `buy`, `sell`, and `record_service_payment_*` take `&LaunchpadConfig` (immutable) and parallelize across agents.

```move
public struct LaunchpadConfig has key {
    id: UID,
    admin: address,
    platform_treasury: address,

    // ---- Trade fee economics ----
    trade_fee_bps: u64,                     // default: 100 (1%)
    trade_nav_share_bps: u64,               // default: 3000
    trade_creator_share_bps: u64,           // default: 6000
    trade_platform_share_bps: u64,          // default: 1000

    // ---- Service-payment-in-SUI economics ----
    service_nav_share_bps: u64,             // default: 4000
    service_creator_share_bps: u64,         // default: 5000
    service_platform_share_bps: u64,        // default: 1000

    // ---- Service-payment-in-token economics ----
    token_service_nav_share_bps: u64,       // default: 4000
    token_service_burn_share_bps: u64,      // default: 5000
    token_service_creator_share_bps: u64,   // default: 1000

    // ---- Bonding curve parameters (snapshotted at launch) ----
    virtual_sui_reserves: u64,              // default: 10_000 * 1e9 MIST
    virtual_token_reserves: u64,            // default: 1_073_000_000 * 1e9
    sale_supply: u64,                       // default: 800_000_000 * 1e9
    lp_supply: u64,                         // default: 200_000_000 * 1e9

    // ---- Cred multiplier saturation threshold ----
    cred_revenue_target: u64,               // default: 1_000 * 1e9 MIST
}
```

**Invariants** (enforced on every admin update):
- `trade_nav_share_bps + trade_creator_share_bps + trade_platform_share_bps == 10000`
- `service_nav_share_bps + service_creator_share_bps + service_platform_share_bps == 10000`
- `token_service_nav_share_bps + token_service_burn_share_bps + token_service_creator_share_bps == 10000`
- `trade_fee_bps > 0`
- `cred_revenue_target > 0`

### 4.2 `LaunchpadAccount<phantom T>` (shared, one per agent)

The per-agent launchpad object. **This object IS the pool.** It also links to the sibling `AgentTreasury<T>` (where the agent's general-purpose property lives) and reserves a slot for the v1.1 Ika dWallets object.

```move
public struct LaunchpadAccount<phantom T> has key {
    id: UID,

    // ---- Ownership and identity ----
    creator: address,                       // snapshot at launch (fee-receiving wallet for trade/service fees)
    linked_identity: Option<ID>,            // optional pointer to SAI / Walrus / other
    coin_type_name: String,
    total_supply: u64,
    decimals: u8,

    // ---- Bonding curve state ----
    real_sui_balance: Balance<SUI>,
    real_token_balance: Balance<T>,
    virtual_sui_reserves: u64,
    virtual_token_reserves: u64,

    // ---- LP reserve (locked permanently in v1) ----
    lp_reserve: Balance<T>,

    // ---- NAV: accumulates from trade fees AND service payments ----
    nav_sui: Balance<SUI>,                  // non-withdrawable
    nav_token: Balance<T>,                  // non-withdrawable

    // ---- Productive-asset layer ----
    access_threshold: u64,                  // 0 = open
    accept_coin_payments: bool,
    lifetime_service_revenue_sui: u64,
    cred_revenue_target: u64,

    // ---- Linkage to sibling objects ----
    treasury_cap_holder_id: ID,             // bidirectional invariant
    agent_treasury_id: ID,                  // sibling AgentTreasury<T>
    owner_cap_id: ID,                       // OwnerCap minted at launch
    dwallets_object_id: Option<ID>,         // RESERVED for v1.1 Ika adapter

    // ---- Cumulative stats (per-account) ----
    total_buys: u64,
    total_sells: u64,
    total_service_payments_sui: u64,
    total_service_payments_token: u64,
    cumulative_volume_sui: u64,
    cumulative_fees_sui: u64,
    launched_at: u64,
}
```

**No `graduated` flag in v1.** Bonding curve trades indefinitely.

### 4.3 `TreasuryCapHolder<phantom T>` (shared, locked)

Wraps the `TreasuryCap<T>` after launch. Used only for `coin::burn` inside `record_service_payment_token`. No public accessor returns the cap.

```move
public struct TreasuryCapHolder<phantom T> has key {
    id: UID,
    cap: TreasuryCap<T>,
    launchpad_account_id: ID,
}
```

### 4.4 `OwnerCap<phantom T>` (owned, transferable)

The sovereign capability over an agent's treasury. Holds full withdrawal rights and authority to issue/revoke `OperatorCap`s. **Transferring this Cap effectively transfers ownership of the agent's bank account.** This is the canonical "transfer the agent" primitive.

```move
public struct OwnerCap<phantom T> has key, store {
    id: UID,
    agent_treasury_id: ID,                  // bidirectional invariant
}
```

**Identity portability:** OwnerCap is `key + store`. Standard `sui::transfer::public_transfer` transfers it. A future v1.5 `set_creator` need not be a custom function — handing the OwnerCap to a new address IS the transfer.

### 4.5 `OperatorCap<phantom T>` (owned, transferable, scoped)

Daily-ops capability with on-chain policy. Held by the agent's runtime (or by another delegate). Spend limits, allowlists, and TTL are enforced by Move.

```move
public struct OperatorCap<phantom T> has key, store {
    id: UID,
    agent_treasury_id: ID,                  // bidirectional invariant
    daily_limit_sui: u64,                   // MIST per UTC day
    spent_today_sui: u64,                   // mutated by operator_spend_sui
    epoch_day: u64,                         // floor(clock_ms / 86_400_000); resets daily
    allowed_targets: vector<address>,       // empty = no transfer-out allowed
    expires_at_ms: u64,                     // hard expiry; 0 = no expiry
}
```

**Active set tracking:** `AgentTreasury<T>` holds `active_operator_cap_ids: vector<ID>`. Revocation removes the ID from this list; presenting a revoked cap aborts.

### 4.6 `AgentTreasury<phantom T>` (shared, one per agent)

The agent's general-purpose treasury — separate from `LaunchpadAccount.nav_*` (which is the productive treasury, non-withdrawable). Holds working capital: `Coin<SUI>`, `Coin<T>`, and (via dynamic fields) arbitrary other coin types and NFTs received via transfer-to-object.

```move
public struct AgentTreasury<phantom T> has key {
    id: UID,
    launchpad_account_id: ID,               // back-ref; bidirectional invariant
    owner_cap_id: ID,                       // OwnerCap that gates this treasury
    active_operator_cap_ids: vector<ID>,    // for revocation enforcement

    sui_balance: Balance<SUI>,
    token_balance: Balance<T>,

    // Dynamic fields hold:
    //   - Balance<X> for arbitrary other coin types claimed via Receiving<Coin<X>>
    //   - NFTs / other Sui objects routed via transfer-to-object
}
```

**Why a separate object from `LaunchpadAccount`:**
- Keeps the launchpad's hot path (trades) lean — `LaunchpadAccount` mutations on every buy/sell don't touch the treasury.
- Treasury can evolve independently (e.g., adding the v1.1 Ika `dwallets` linkage, v1.5 NFT Kiosk integration, v2 sub-agent composition).
- Different access patterns: treasury writes are owner/operator-gated; trades are permissionless.

**`nav_sui` / `nav_token` (on `LaunchpadAccount`) vs `sui_balance` / `token_balance` (on `AgentTreasury`):**
- NAV is the productive treasury. Non-withdrawable. Backs the hire-price view. Grows from trade fees and service payments.
- Treasury balances are the operational treasury. Owner-withdrawable, operator-spendable within scope. Grows from `transfer-to-object` inbound payments and explicit `top-up` calls.

### 4.7 Events

```move
public struct LaunchEvent has copy, drop {
    launchpad_id: ID,
    agent_treasury_id: ID,
    owner_cap_id: ID,
    treasury_cap_holder_id: ID,
    coin_type_name: String,
    creator: address,
    linked_identity: Option<ID>,
    timestamp: u64,
}

public struct TradeEvent has copy, drop {
    launchpad_id: ID,
    trader: address,
    is_buy: bool,
    sui_in: u64,
    tokens_out: u64,
    sui_out: u64,
    tokens_in: u64,
    fee_sui: u64,
    new_real_sui_balance: u64,
    new_real_token_balance: u64,
    timestamp: u64,
}

public struct FeeDistributedEvent has copy, drop {
    launchpad_id: ID,
    source: u8,                             // 0 = trade, 1 = service_sui, 2 = service_token
    total: u64,
    nav_share: u64,
    creator_share: u64,
    platform_or_burn_share: u64,
}

public struct ServicePaymentEvent has copy, drop {
    launchpad_id: ID,
    payer: address,
    sui_amount: u64,
    token_amount: u64,
    counted_toward_cred: bool,
    new_lifetime_revenue_sui: u64,
    timestamp: u64,
}

public struct AccessConfigEvent has copy, drop {
    launchpad_id: ID,
    access_threshold: u64,
    accept_coin_payments: bool,
}

public struct LinkedIdentityEvent has copy, drop {
    launchpad_id: ID,
    linked_identity: Option<ID>,
}

public struct OperatorCapIssuedEvent has copy, drop {
    agent_treasury_id: ID,
    operator_cap_id: ID,
    recipient: address,
    daily_limit_sui: u64,
    allowed_targets: vector<address>,
    expires_at_ms: u64,
}

public struct OperatorCapRevokedEvent has copy, drop {
    agent_treasury_id: ID,
    operator_cap_id: ID,
}

public struct TreasuryWithdrawEvent has copy, drop {
    agent_treasury_id: ID,
    coin_type: u8,                          // 0 = SUI, 1 = T, 2 = dynamic-field other
    amount: u64,
    to: address,
    via: u8,                                // 0 = OwnerCap, 1 = OperatorCap
}
```

---

## 5. Mechanism

### 5.1 Launch (`launch_agent_coin<T>`)

Atomic v1 launch in one Move call. Consumes the `TreasuryCap`, creates four shared objects (`LaunchpadAccount`, `AgentTreasury`, `TreasuryCapHolder`), mints two capabilities (`OwnerCap` always, `OperatorCap` optional), and emits `LaunchEvent`. The coin module must be published in a prior tx.

**Inputs:**

- `config: &LaunchpadConfig` (immutable)
- `treasury_cap: TreasuryCap<T>` (consumed)
- `coin_metadata: &CoinMetadata<T>`
- `coin_type_name: String`
- `linked_identity: Option<ID>` (external identity)
- `owner_cap_recipient: address` (who receives OwnerCap)
- `operator_recipient: Option<address>` (if Some, mints an OperatorCap to this address)
- `operator_daily_limit_sui: u64` (used only if operator_recipient is Some)
- `operator_allowed_targets: vector<address>` (used only if operator_recipient is Some)
- `operator_ttl_ms: u64` (used only if operator_recipient is Some)
- `clock: &Clock`

**Preconditions:**

- `coin::total_supply(&treasury_cap) == 0` — cap must be fresh.

**Effects:**

1. Mint `sale_supply` of `T` → `real_token_balance`.
2. Mint `lp_supply` of `T` → `lp_reserve`.
3. Snapshot curve parameters and `cred_revenue_target` from config.
4. Build `TreasuryCapHolder<T>` and share.
5. Build `AgentTreasury<T>` and share.
6. Mint `OwnerCap<T>` and transfer to `owner_cap_recipient`.
7. If `operator_recipient` is Some: mint `OperatorCap<T>` with the provided scope and transfer to that address; push its ID to `agent_treasury.active_operator_cap_ids`.
8. Build `LaunchpadAccount<T>` with `creator = tx_context::sender(ctx)`, zero balances, `dwallets_object_id: option::none()`. Share.
9. Emit `LaunchEvent` (and `OperatorCapIssuedEvent` if applicable).

**Authorization:** holding a fresh `TreasuryCap<T>` is the proof of authorship. No identity check required.

**Three modes** — same function signature, different recipients:

| Mode | `owner_cap_recipient` | `operator_recipient` |
|---|---|---|
| Sovereign agent | agent's TEE-bound address | agent's TEE-bound address (or session key) |
| Commissioned agent | human's wallet | agent's runtime address |
| Spawned sub-agent | parent agent's OwnerCap holder address | sub-agent's runtime address |

The CLI's `tai launch` exposes all four as flags; defaults are sovereign mode (both recipients = `tx_context::sender`).

**Optional self-buy:** the CLI composes `launch_agent_coin<T>` + an immediate `buy<T>` in the same PTB when `--self-buy-sui` is provided.

### 5.2 Bonding curve math

Constant-product against virtual + real reserves. All multiplications use `u128` intermediates; downcasts to `u64` are guarded by `assert!(x <= MAX_U64, EMathOverflow)`.

```
total_sui   = real_sui   + virtual_sui
total_token = real_token + virtual_token
k           = total_sui * total_token
```

**Buy:**
```
fee             = (u128(sui_in) * u128(fee_bps)) / 10_000          // downcast asserted
sui_net         = sui_in - fee
total_sui_new   = total_sui + sui_net
total_token_new = k / total_sui_new
tokens_out      = total_token - total_token_new
```

**Sell:**
```
total_token_new = total_token + tokens_in
total_sui_new   = k / total_token_new
sui_gross       = total_sui - total_sui_new
fee             = (u128(sui_gross) * u128(fee_bps)) / 10_000        // downcast asserted
sui_out         = sui_gross - fee
```

**Slippage:** mandatory `min_tokens_out` on buy, `min_sui_out` on sell.

**Liquidity guard:** `assert!(tokens_out <= real_token, EInsufficientLiquidity)` on buy; `assert!(sui_gross <= real_sui, EInsufficientLiquidity)` on sell.

### 5.3 Trade (`buy<T>`, `sell<T>`)

Both take `&LaunchpadConfig` (immutable) and `&mut LaunchpadAccount<T>`. Different agents trade in parallel.

Same as v1 design: see prior iterations. Unchanged.

### 5.4 Service payments

Two entry functions: `record_service_payment_sui<T>` and `record_service_payment_token<T>`. SPEC mechanics unchanged from prior iteration. Self-pump exclusion still applies (payer == account.creator → NAV grows but `lifetime_service_revenue_sui` does not).

Burn-on-token-service-payment uses `&mut TreasuryCapHolder<T>` to call `coin::burn`. The burn path is the only public mutation of the cap post-launch. The cap accessor is `public(package)` only.

### 5.5 Fee distribution (`fees` module)

Three pure compute functions: `compute_trade_split`, `compute_service_sui_split`, `compute_token_service_split`. Two distribution functions: `distribute_sui` and `distribute_token<T>`. All math uses `u128` intermediates.

### 5.6 NAV access

NAV (`nav_sui` + `nav_token`) on `LaunchpadAccount<T>` is **non-withdrawable**. There is no function that takes from either balance and transfers it out. NAV backs the hire-price view and (in v1.5) holder distributions / collateralized loans.

NAV is distinct from the agent's general-purpose treasury (`AgentTreasury<T>.sui_balance` and `token_balance`), which IS withdrawable via OwnerCap and spendable via OperatorCap within scope.

### 5.7 Effective hire price (`views::effective_hire_price`)

Self-referential, no external dep. Reads `nav_sui` + `lifetime_service_revenue_sui` + `cred_revenue_target` from the launchpad account.

```move
public fun effective_hire_price<T>(account: &LaunchpadAccount<T>): u64 {
    let nav    = balance::value(&account.nav_sui);
    let earned = account.lifetime_service_revenue_sui;
    let target = account.cred_revenue_target;

    let bonus_u128 = ((earned as u128) * 10_000u128) / (target as u128);
    let capped_bonus = if (bonus_u128 > 10_000u128) 10_000u128 else bonus_u128;
    let mult_bps_u128 = 10_000u128 + capped_bonus;

    let hp_u128 = (nav as u128) * mult_bps_u128 / 10_000u128;
    assert!(hp_u128 <= (MAX_U64 as u128), EMathOverflow);
    hp_u128 as u64
}
```

`hire_quote<T>(account) -> (nav, earned, target, mult_bps, hire_price)` returns all five for UIs/CLIs.

### 5.8 Access configuration

Creator-only on `LaunchpadAccount` (sender == `account.creator`):
- `set_access_config<T>(account, threshold, accept_coin, ctx)` — sets `access_threshold` and `accept_coin_payments`.
- `set_linked_identity<T>(account, identity, ctx)` — sets/clears `linked_identity`.

**Note:** `account.creator` is the fee-receiving wallet snapshot. It's a separate concept from `OwnerCap` holder. The two can be the same address (default) or different (commissioned mode). In v1.5 we may consolidate them; for now keep separate to preserve fee-routing flexibility.

### 5.9 Admin functions

LaunchpadConfig admin can update fee bps (with sum-to-10000 invariants), `cred_revenue_target` (must be > 0), `platform_treasury`, and `transfer_admin`. Admin cannot drain any account. Admin cannot modify already-launched account parameters.

### 5.10 Treasury operations

`AgentTreasury<T>` is created automatically inside `launch_agent_coin<T>`. There is no separate `create_treasury` entry function in v1.

**OwnerCap-gated withdrawals:**

```move
public entry fun withdraw_sui<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    amount: u64,
    to: address,
    ctx: &mut TxContext,
);

public entry fun withdraw_token<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    amount: u64,
    to: address,
    ctx: &mut TxContext,
);
```

Both assert `owner_cap.agent_treasury_id == object::id(treasury)`. Both emit `TreasuryWithdrawEvent { via: 0 }`.

**Anyone can top up:**

```move
public entry fun top_up_sui<T>(treasury: &mut AgentTreasury<T>, payment: Coin<SUI>);
public entry fun top_up_token<T>(treasury: &mut AgentTreasury<T>, payment: Coin<T>);
```

Permissionless; routes the coin into the typed balance. Useful for explicit funding.

**Transfer-to-object claim:**

```move
public entry fun claim_received_sui<T>(
    treasury: &mut AgentTreasury<T>,
    receiving: Receiving<Coin<SUI>>,
);

public entry fun claim_received_coin<X, T>(
    treasury: &mut AgentTreasury<T>,
    receiving: Receiving<Coin<X>>,
);
```

`claim_received_sui` joins to the typed `sui_balance`. `claim_received_coin<X, T>` joins to a dynamic-field `Balance<X>` keyed by the type tag of `X` (created lazily on first claim). Both permissionless — anyone can route a received coin into the treasury's typed balance.

### 5.11 OperatorCap lifecycle

**Issue:**

```move
public entry fun issue_operator_cap<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    recipient: address,
    daily_limit_sui: u64,
    allowed_targets: vector<address>,
    ttl_ms: u64,                            // 0 = no expiry
    clock: &Clock,
    ctx: &mut TxContext,
);
```

Mints a fresh `OperatorCap<T>`, pushes its ID to `treasury.active_operator_cap_ids`, transfers to recipient. Emits `OperatorCapIssuedEvent`.

**Revoke:**

```move
public entry fun revoke_operator_cap<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    cap_id: ID,
);
```

Removes `cap_id` from `treasury.active_operator_cap_ids`. The cap object itself stays in the recipient's address inventory (it can be deleted at their leisure), but any presentation aborts because the active-set check fails.

**Spend (OperatorCap-gated):**

```move
public entry fun operator_spend_sui<T>(
    treasury: &mut AgentTreasury<T>,
    op_cap: &mut OperatorCap<T>,
    amount: u64,
    to: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. assert op_cap.agent_treasury_id == object::id(treasury)
    // 2. assert vector::contains(&treasury.active_operator_cap_ids, &object::id(op_cap)) (not revoked)
    // 3. assert op_cap.expires_at_ms == 0 || clock::timestamp_ms(clock) < op_cap.expires_at_ms
    // 4. assert vector::contains(&op_cap.allowed_targets, &to)
    // 5. refresh op_cap.epoch_day; reset spent_today_sui if rolled over
    // 6. assert op_cap.spent_today_sui + amount <= op_cap.daily_limit_sui
    // 7. op_cap.spent_today_sui += amount
    // 8. split SUI from treasury.sui_balance; transfer to `to`
    // 9. emit TreasuryWithdrawEvent { via: 1 }
}
```

Daily epoch reset: `epoch_day = clock::timestamp_ms(clock) / 86_400_000`. When the operator presents the cap on a new UTC day, the function rewrites `epoch_day` and zeroes `spent_today_sui` before checking the limit.

A symmetric `operator_spend_token<T>` exists for treasury token spending.

### 5.12 Modes

The same Move primitives support three operational modes, distinguished only by who holds the OwnerCap and OperatorCap:

**Sovereign agent.** OwnerCap → agent's own (TEE-bound or self-managed) address. OperatorCap → same address or a session key on the same machine. The agent owns itself. Common for autonomous agents running in Phala TEE with Nautilus attestation. Recovery: whatever the agent's runtime supports (sealed storage backups, recovery keys held by a trusted party).

**Commissioned agent.** OwnerCap → human commissioner's wallet (zkLogin, Sui Wallet, multisig). OperatorCap → agent's runtime address. Human has ultimate control; agent operates autonomously day-to-day. Most common pattern; default in `tai-cli` web demo.

**Spawned sub-agent.** OwnerCap → parent agent's OwnerCap holder address (transitively, the parent's OwnerCap holder controls both). OperatorCap → sub-agent's runtime. Enables hierarchical agent composition. v1 supports this through normal calls; on-chain parent-child accounting (revenue splits, hierarchical dashboards) is v2.

Mode is not stored on-chain; it's an emergent property of cap distribution. The CLI's `tai launch` flags let any mode be configured at launch.

---

## 6. Lifecycle (end-to-end, agent-native)

1. **Prerequisite (optional):** creator registers an identity in SAI or any other identity system. Captures the object ID for step 3.
2. **Tx 1 — publish coin module.** Creator (or agent runtime) calls `tai-cli`'s built-in bytecode templater to generate the OTW coin module bytecode, then publishes it. Receives `TreasuryCap<T>` and `CoinMetadata<T>`. The CLI handles this in one command, capturing object IDs.
3. **Tx 2 — launch.** Single PTB: `launch_agent_coin<T>` consumes the cap, creates `LaunchpadAccount` + `AgentTreasury` + `TreasuryCapHolder` (all shared), mints `OwnerCap` to `--owner-cap-recipient`, optionally mints `OperatorCap` to `--operator-cap-recipient` with declared scope, optionally chains `buy<T>` for self-seed. Emits all relevant events.
4. **Trading begins immediately.** Anyone can `buy<T>` or `sell<T>`.
5. **Agent earns service revenue.** Runtime calls `record_service_payment_sui` (or `_token`) after collecting a hire. NAV grows; cred multiplier scales.
6. **Agent spends from treasury.** Runtime calls `operator_spend_sui` to pay third parties within OperatorCap scope (daily limit, allowlist, TTL). Compromise of the operator key → revoke the cap; treasury safe.
7. **Treasury receives external coins.** Anyone can `transfer-to-object` `Coin<X>` to the treasury's address; the runtime later calls `claim_received_coin<X, T>` to materialize it as a typed balance.
8. **Owner withdraws or rotates.** OwnerCap holder can `withdraw_sui` / `withdraw_token` for any amount, `issue_operator_cap` for new scopes, `revoke_operator_cap` to invalidate old ones.
9. **Ownership transfer.** Owner can `sui::transfer::public_transfer` the OwnerCap. The new holder owns the entire treasury atomically.
10. **Bonding curve continues indefinitely.** No graduation in v1.

**Cost to launch:** gas only. Both txs sponsorable. Zero seed capital required.

---

## 7. Errors

```move
const ENotCreator: u64                = 100;
const ENotOwnerCap: u64               = 101;   // wrong OwnerCap for this treasury
const ENotOperatorCap: u64            = 102;   // wrong OperatorCap for this treasury
const EOperatorCapRevoked: u64        = 103;   // cap not in active_operator_cap_ids
const ETreasuryCapNotEmpty: u64       = 104;
const ELaunchpadMismatch: u64         = 105;
const ECoinPaymentsDisabled: u64      = 107;
const EOperatorCapExpired: u64        = 108;
const EOperatorTargetNotAllowed: u64  = 109;
const EFeeBpsInvalid: u64             = 110;
const EFeeBpsZero: u64                = 111;
const ECredTargetZero: u64            = 113;
const EOperatorDailyLimitExceeded: u64 = 115;
const EInsufficientLiquidity: u64     = 120;
const ESlippageExceeded: u64          = 121;
const EMathOverflow: u64              = 122;
const ENotAdmin: u64                  = 140;
```

---

## 8. Decisions baked in (do not re-litigate)

| Decision | Value | Why |
|---|---|---|
| SAI dependency | None in v1 core | Testnet-only; adapter package later |
| Ika dependency | None in v1 core; field reserved | Production but young; adapter ships v1.1 |
| Quote currency | SUI | One-currency math; USDC is v1.5 |
| Total supply | 1B tokens, 9 decimals | Sui convention |
| Sale / LP split | 800M / 200M | LP locked permanently in v1 |
| Virtual SUI reserves | 10,000 SUI | Initial price ≈ 9.3e-6 SUI/token |
| Trading fee | 100 bps (1%) | Matches Bags |
| Trade fee split | 30 / 60 / 10 (NAV / creator / platform) | Generous to creator |
| Service-SUI fee split | 40 / 50 / 10 | Higher NAV share — service revenue is the NAV thesis |
| Service-token fee split | 40 / 50 / 10 (NAV-in-T / burn / creator) | Burn supports price floor |
| Cred saturation target | 1000 SUI lifetime revenue | Tunable by admin |
| Cred range | 1.0x → 2.0x, monotone | No decay in v1 |
| Self-payment | Allowed; not counted toward cred | Cosmetic block on self-pump |
| NAV withdrawal | Disallowed | Backs hire price + v1.5 collateral |
| Treasury withdrawal | Allowed via OwnerCap | Owner can move working capital freely |
| OperatorCap policy | Daily limit + allowlist + TTL | Move-enforced; rotatable on compromise |
| AgentTreasury creation | Automatic in launch_agent_coin | One-call launch; no separate setup |
| OwnerCap | Always minted at launch to `owner_cap_recipient` | Transferable (key + store); "set_creator" is just `public_transfer` |
| OperatorCap at launch | Optional via `operator_recipient` | Caller can issue later if mode/runtime not yet decided |
| OwnerCap vs creator address | Distinct concepts | OwnerCap gates treasury; `creator` snapshot receives trade/service fees |
| Liquidity venue | Bonding curve only | Cetus v1.5, DeepBook v2 |
| Seed capital required | Zero | Virtual reserves; first buyer funds pool |
| Graduation | None in v1 | Curve trades indefinitely |
| Holder distributions | Not in v1 | Revenue plumbing only; claim flow v1.5 |
| Launch tx count | Two | Publish + launch; one-tx is v1.5 |
| Identity linkage | `Option<ID>` field | Pluggable; SAI / Walrus / anything |
| Cross-chain custody linkage | `dwallets_object_id: Option<ID>` reserved field | v1.1 Ika adapter |
| NFTs in treasury | Dynamic fields | Kiosk integration is v1.5 |
| Primary access surface | `tai-cli` (Rust binary) | Language-agnostic; agent-native; TEE-friendly |
| SDK | `@tai/sdk` (TypeScript, WASM-wrapping tai-core) | Derivative of CLI |
| Web demo | Wraps SDK; not canonical | Explorability + hire discovery surface for humans |
| TEE signer in v1 | Yes (Phala Cloud + Nautilus attestation) | Sovereign-mode requirement |
| Sponsored gas | Yes for launch txs and first N service-payment calls | Removes boot-funding chicken-and-egg |

---

## 9. v1.5 / v2 roadmap (do NOT implement in v1)

- **v1.1: Tai-Ika-Adapter package.** Sibling Move package adding `AgentDWallets<T>` linked via `dwallets_object_id`. Supports BTC/ETH/Solana/EdDSA-family agent treasuries. Move-enforced OperatorCap policy applies to cross-chain spends identically to SUI spends.
- **v1.5: Holder distribution claim flow.** Per-holder dynamic-field accrual or Merkle-airdrop claim; separates from NAV.
- **v1.5: Cred decay.** Multiplier decays if no service payment in N days.
- **v1.5: Tai-SAI-Adapter.** Composes SAI cred multiplier with Tai's self-referential one; can auto-recognize SAI delegates as OperatorCap-equivalent.
- **v1.5: Optional Cetus mirror pool.** Threshold-triggered LP-release flow.
- **v1.5: USDC-quoted curves and USDC service payments.**
- **v1.5: One-transaction launch.** On-client bytecode templating with same-PTB publish chaining.
- **v1.5: Kiosk integration** for agent-owned NFTs.
- **v1.5: Sponsored-gas budget per agent**, tracked on-chain.
- **v2: DeepBook integration** behind volume gate.
- **v2: On-chain hire-flow object** with escrow + completion attestation.
- **v2: Capability lending / skill leasing.**
- **v2: Sub-agent composition** with parent-child revenue splits.
- **v2: Collateralization adapter** (NAVI / Suilend).
- **v2: Kiosk-based secondary marketplace** for LaunchpadAccount transfer.

---

## 10. Security considerations

- **Reentrancy:** Move resource model + PTB execution prevent classic reentrancy.
- **Integer overflow:** every multiplication uses `u128` intermediates. Every downcast to `u64` is preceded by `assert!(x <= MAX_U64, EMathOverflow)`. Non-negotiable.
- **Admin power:** admin can change future fee bps, `cred_revenue_target`, treasury address. Admin **cannot** drain any LaunchpadAccount or AgentTreasury. Non-negotiable invariant.
- **TreasuryCap usage:** cap is held by `TreasuryCapHolder<T>`. Used only by `record_service_payment_token` for burn. Burn accessor `public(package)` only.
- **OwnerCap compromise:** ownership of OwnerCap = full treasury drain authority. Mitigations: (a) make OwnerCap holder a multisig address, (b) use TEE-bound signing, (c) document the high-stakes nature in CLI output.
- **OperatorCap compromise:** scope-limited blast radius. `daily_limit_sui` caps daily loss; `allowed_targets` caps destination; `expires_at_ms` caps duration. Recovery: revoke via OwnerCap, issue fresh OperatorCap. Treasury safe.
- **OperatorCap replay across days:** `epoch_day` is `clock_ms / 86_400_000` — UTC-day granular. Acceptable for v1; flagged for review if attacker can manipulate clock skew (Sui's Clock is consensus-set, so manipulation is bounded).
- **Cross-object linkage:** bidirectional invariants on every cross-object call (OwnerCap ↔ AgentTreasury, OperatorCap ↔ AgentTreasury, TreasuryCapHolder ↔ LaunchpadAccount, AgentTreasury ↔ LaunchpadAccount).
- **Service-payment self-pump:** payer == creator excluded from `lifetime_service_revenue_sui`. Collusion (creator pays a friend, friend pays back) raises Sybil cost but isn't fully prevented; off-chain heuristics flag.
- **Permissionless `record_service_payment_*` and `top_up_*`:** anyone can fund an agent. No abuse vector beyond donating value.
- **Front-running:** sandwich attacks possible on the curve. Mitigated only via `min_out` slippage in v1.
- **Sponsored gas trust model:** the sponsor (Tai platform, Shinami, or Sui Gas Pool) sees the full PTB. Privacy-sensitive operations should self-fund. Documented in CLI output.
- **TEE-attestation trust model (when used):** the TEE provider (Phala Cloud, AWS Nitro, Intel TDX) is the trust anchor. Validate attestation reports before relying on TEE signatures. v1 supports Phala Cloud + Nautilus by default; users can plug other TEEs via the generic signer interface.

---

## 11. Test coverage requirements

Every entry function: success + one failure per documented error code + boundary tests.

Every view function: known input → known output, plus boundary tests.

Specific cases:

- Launch creates exactly one of each: LaunchpadAccount, AgentTreasury, TreasuryCapHolder. OwnerCap minted to `owner_cap_recipient`. (Optional) OperatorCap minted to `operator_recipient`.
- Bidirectional invariants on every linkage.
- `dwallets_object_id` is `option::none` on a fresh launchpad (v1.1 sets it later).
- Trade + service-payment flows unchanged from prior coverage.
- `withdraw_sui` with valid OwnerCap → success.
- `withdraw_sui` with foreign OwnerCap → `ENotOwnerCap`.
- `issue_operator_cap` → cap minted, ID in `active_operator_cap_ids`.
- `revoke_operator_cap` → ID removed; subsequent presentation aborts with `EOperatorCapRevoked`.
- `operator_spend_sui` within scope → success; balance moves; `spent_today_sui` increments.
- `operator_spend_sui` exceeding `daily_limit_sui` → `EOperatorDailyLimitExceeded`.
- `operator_spend_sui` to non-allowed target → `EOperatorTargetNotAllowed`.
- `operator_spend_sui` after `expires_at_ms` → `EOperatorCapExpired`.
- `operator_spend_sui` after revocation → `EOperatorCapRevoked`.
- `operator_spend_sui` across UTC day rollover → `spent_today_sui` resets, full daily limit available again.
- `top_up_sui` from any sender → balance grows; permissionless.
- `claim_received_sui` after a `transfer-to-object` of a SUI coin → balance grows.
- Mode A (sovereign): owner_cap_recipient == operator_recipient == sender. OwnerCap and OperatorCap both arrive at sender's inventory.
- Mode B (commissioned): owner_cap_recipient != operator_recipient. Each cap arrives at the right address.
- OwnerCap transfer via `sui::transfer::public_transfer` → subsequent `withdraw_sui` from old holder aborts; from new holder succeeds.
- Hire-price formula at zero / target / 2× target revenue.
- Admin updates each fee policy with invalid sum → abort.

The PLAN enforces these via per-task TDD steps.

---

## 12. Access surface and developer ergonomics

Tai's access layers, from canonical to derivative:

1. **`tai-cli`** (Rust binary) — canonical. Wraps every Move call via `tai-core`. Distributes as static binary + Homebrew tap + Docker image + GitHub Releases. JSON output mode for piping. Three built-in signer modes: `ed25519` (local key file), `sui-keystore` (inherits from `sui client`), `tee` (Phala Cloud + Nautilus attestation).
2. **`tai-core`** (Rust crate) — the library both the CLI and the WASM SDK share. PTB builders, signer abstraction, indexer client, coin-module bytecode templater.
3. **`@tai/sdk`** (TypeScript) — WASM-backed wrapper over `tai-core`. For JS-native agent runtimes (Eliza, Node, Bun, edge workers) and for the web demo.
4. **Web demo** — explorability and hire-discovery surface. Wraps the TS SDK. Not the canonical interface.

**Agent-native flow** (no UI):

```sh
tai init --signer-mode tee --tee-endpoint $PHALA_ENDPOINT --network testnet
LAUNCH=$(tai launch \
  --name "$AGENT_NAME" \
  --symbol "$AGENT_SYMBOL" \
  --image-blob "$WALRUS_BLOB_ID" \
  --owner-cap-recipient "$AGENT_ADDRESS" \
  --operator-cap-recipient "$AGENT_ADDRESS" \
  --operator-daily-limit-sui 10000000000 \
  --operator-allowlist "$ALLOWLIST_CSV" \
  --operator-ttl-days 90 \
  --output json)

LAUNCHPAD_ID=$(echo "$LAUNCH" | jq -r .launchpad_id)
TREASURY_ID=$(echo "$LAUNCH" | jq -r .agent_treasury_id)
OPERATOR_CAP=$(echo "$LAUNCH" | jq -r .operator_cap_id)

# Main loop: when the agent collects a hire payment in SUI:
tai pay sui --launchpad "$LAUNCHPAD_ID" --coin "$PAYMENT_COIN_OBJECT_ID"

# When the agent needs to pay a third party from its treasury:
tai op spend-sui --treasury "$TREASURY_ID" --operator-cap "$OPERATOR_CAP" \
  --amount 100000000 --to "$RECIPIENT_ADDRESS"
```

No browser. No OAuth. No env-var paste between systems. The agent IS the runtime; the CLI is its tool.
