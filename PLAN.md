# Tai Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in order. Use TDD: write the failing test first, run it, implement, run again, commit. Do not skip ahead. Do not invent features not in [SPEC.md](./SPEC.md).

**Goal:** Ship Tai v1 — the Sui Move package, the `tai-core` Rust crate, the `tai-cli` binary, and a thin WASM-backed `@tai/sdk`. The product is: any creator can launch an agent coin under Tai's bonding-curve AMM in two transactions, the launch automatically creates an `AgentTreasury<T>` with `OwnerCap` + optional `OperatorCap`, the agent earns NAV from trading fees AND on-chain service payments, the hire-price view is self-referential, and the agent custodies its own property through Move-enforced capability policy. Primary access surface is `tai-cli`. v1 is Sui-only; v1.1 ships `Tai-Ika-Adapter` for cross-chain custody (the linkage field is reserved on `LaunchpadAccount`).

**Architecture:**

```
Move (Sui):
  tai::launchpad        // LaunchpadAccount, TreasuryCapHolder, launch, buy/sell, service payments, access, admin
  tai::bonding_curve    // pure math (u128 intermediates)
  tai::fees             // split + distribute (trade / service_sui / service_token)
  tai::agent_treasury   // AgentTreasury<T>, OwnerCap<T>, OperatorCap<T>, treasury ops, cap lifecycle
  tai::views            // self-referential hire-price view

Rust:
  tai-core (lib)        // PTB builders, signer abstraction, indexer client, OTW bytecode templater
  tai-cli (bin)         // language-agnostic agent surface; static binary; TEE signer support

TypeScript:
  @tai/sdk              // WASM-backed wrapper over tai-core
  web demo              // wraps SDK; explorability + hire discovery
```

**Tech stack:** Move 2024.beta, Sui framework rev `95cddc3f5`, `@mysten/sui` v1.21+ for the WASM SDK consumers, Rust stable + `sui-sdk` for `tai-core`/`tai-cli`, `clap` for CLI parsing, `wasm-pack` for SDK builds. Tests via `sui move test` (Move) and `cargo test` (Rust).

---

## Prerequisites for the implementing agent

- [ ] `sui --version` returns >= 1.30.
- [ ] `cargo --version` returns >= 1.78.
- [ ] `wasm-pack --version` installed.
- [ ] Testnet wallet has SUI: `sui client gas`.
- [ ] Read [SPEC.md](./SPEC.md) cover-to-cover. Spec is authoritative; if PLAN and SPEC disagree, follow SPEC.
- [ ] **No SAI dependency, no Ika dependency.** v1 core depends only on the Sui framework. Adapter packages ship separately.

---

## Phase 0: Scaffold

### Task 0.1: Create Move package skeleton

- Create: `Tai-Launchpad/move/Move.toml`, `move/sources/.gitkeep`, `move/tests/.gitkeep`.

`Move.toml`:

```toml
[package]
name = "tai"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "95cddc3f5" }

[addresses]
tai = "0x0"
```

- [ ] `cd Tai-Launchpad/move && sui move build` → success, no modules yet.
- [ ] Commit: `launchpad: scaffold Move package (no SAI/Ika deps)`.

---

## Phase 1: LaunchpadConfig + admin

Global config with three fee-share policies (trade, service-SUI, service-token), curve constants, cred saturation target. No mutable counters — every trade/service-payment takes `&LaunchpadConfig` (immutable) so they parallelize across agents.

### Task 1.1: Define `LaunchpadConfig` and init

- Create: `move/sources/launchpad.move`, `move/tests/launchpad_tests.move`.

**Step 1** — failing test asserting default constants from SPEC §8:

```move
#[test_only]
module tai::launchpad_tests {
    use sui::test_scenario::{Self as ts};
    use tai::launchpad::{Self, LaunchpadConfig};

    const ADMIN: address = @0xAD;

    #[test]
    fun init_creates_shared_config_with_spec_defaults() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        assert!(launchpad::config_admin(&config) == ADMIN, 0);
        assert!(launchpad::config_trade_fee_bps(&config) == 100, 1);
        assert!(launchpad::config_trade_nav_share_bps(&config) == 3000, 2);
        assert!(launchpad::config_trade_creator_share_bps(&config) == 6000, 3);
        assert!(launchpad::config_trade_platform_share_bps(&config) == 1000, 4);

        assert!(launchpad::config_service_nav_share_bps(&config) == 4000, 5);
        assert!(launchpad::config_service_creator_share_bps(&config) == 5000, 6);
        assert!(launchpad::config_service_platform_share_bps(&config) == 1000, 7);

        assert!(launchpad::config_token_service_nav_share_bps(&config) == 4000, 8);
        assert!(launchpad::config_token_service_burn_share_bps(&config) == 5000, 9);
        assert!(launchpad::config_token_service_creator_share_bps(&config) == 1000, 10);

        assert!(launchpad::config_cred_revenue_target(&config) == 1_000_000_000_000, 11);

        ts::return_shared(config);
        ts::end(sc);
    }
}
```

**Step 2** — implement `launchpad.move` with `LaunchpadConfig` struct, all constants, `init()`, getters for every field, and `init_for_testing()`. Match the field layout in SPEC §4.1 exactly.

**Step 3** — run tests, expect PASS. Commit: `launchpad: LaunchpadConfig with trade/service/token fee policies`.

### Task 1.2: Admin entry functions

Failing tests for: `set_platform_treasury`, `set_trade_shares`, `set_service_shares`, `set_token_service_shares`, `set_trade_fee_bps`, `set_cred_revenue_target`, `transfer_admin`. Both success paths and abort paths (non-admin, invalid sum, zero fee, zero target).

Implement entry functions per SPEC §5.9. All share-update functions assert sum-to-10000 invariant. All admin-only functions assert `tx_context::sender(ctx) == config.admin`.

Run tests → PASS. Commit: `launchpad: admin entry functions for all three fee policies + cred target`.

---

## Phase 2: Bonding curve math (pure)

Pure math, no shared-object plumbing. **Every multiplication uses `u128` intermediates with explicit `assert!(x <= MAX_U64, EMathOverflow)` before downcast.**

### Task 2.1: compute_buy

- Create: `move/sources/bonding_curve.move`, `move/tests/bonding_curve_tests.move`.

Failing tests: buy at initial state, buy with zero, buy after partial fill (more expensive), large-input no-overflow test (>1e17 MIST, confirms u128 path).

Implementation:

```move
module tai::bonding_curve {
    const EMathOverflow: u64 = 122;
    const MAX_U64: u128 = 18_446_744_073_709_551_615;

    public fun e_math_overflow(): u64 { EMathOverflow }

    public fun compute_buy(
        real_sui: u64,
        real_token: u64,
        virtual_sui: u64,
        virtual_token: u64,
        sui_in: u64,
        fee_bps: u64,
    ): (u64, u64) {
        if (sui_in == 0) { return (0, 0) };

        let fee_u128 = ((sui_in as u128) * (fee_bps as u128)) / 10_000u128;
        assert!(fee_u128 <= MAX_U64, EMathOverflow);
        let fee = fee_u128 as u64;
        let sui_net = sui_in - fee;

        let total_sui = (real_sui as u128) + (virtual_sui as u128);
        let total_token = (real_token as u128) + (virtual_token as u128);
        let k = total_sui * total_token;

        let new_total_sui = total_sui + (sui_net as u128);
        let new_total_token = k / new_total_sui;

        let tokens_out_u128 = total_token - new_total_token;
        assert!(tokens_out_u128 <= (real_token as u128), EMathOverflow);
        (tokens_out_u128 as u64, fee)
    }
}
```

Run tests → PASS. Commit: `launchpad: compute_buy with u128 intermediates`.

### Task 2.2: compute_sell

Symmetric. Failing tests for sell-after-buy-returns-less, sell-with-zero, and large-input no-overflow. Implementation per SPEC §5.2 sell formula. Run → PASS. Commit: `launchpad: compute_sell with u128 intermediates`.

---

## Phase 3: Core structs

All on-chain object types defined in one phase so subsequent phases can reference them without back-and-forth. No entry functions yet — just structs, events, and getters.

### Task 3.1: Add imports and additional error codes to `launchpad.move`

```move
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
use sui::sui::SUI;
use sui::clock::{Self, Clock};
use sui::event;
use std::option::{Self, Option};
use std::string::String;

const ENotCreator: u64                = 100;
const ENotOwnerCap: u64               = 101;
const ENotOperatorCap: u64            = 102;
const EOperatorCapRevoked: u64        = 103;
const ETreasuryCapNotEmpty: u64       = 104;
const ELaunchpadMismatch: u64         = 105;
const ECoinPaymentsDisabled: u64      = 107;
const EOperatorCapExpired: u64        = 108;
const EOperatorTargetNotAllowed: u64  = 109;
const EOperatorDailyLimitExceeded: u64 = 115;
const EInsufficientLiquidity: u64     = 120;
const ESlippageExceeded: u64          = 121;
const EMathOverflow: u64              = 122;

public fun e_not_creator(): u64 { ENotCreator }
public fun e_not_owner_cap(): u64 { ENotOwnerCap }
public fun e_not_operator_cap(): u64 { ENotOperatorCap }
public fun e_operator_cap_revoked(): u64 { EOperatorCapRevoked }
public fun e_treasury_cap_not_empty(): u64 { ETreasuryCapNotEmpty }
public fun e_launchpad_mismatch(): u64 { ELaunchpadMismatch }
public fun e_coin_payments_disabled(): u64 { ECoinPaymentsDisabled }
public fun e_operator_cap_expired(): u64 { EOperatorCapExpired }
public fun e_operator_target_not_allowed(): u64 { EOperatorTargetNotAllowed }
public fun e_operator_daily_limit_exceeded(): u64 { EOperatorDailyLimitExceeded }
public fun e_insufficient_liquidity(): u64 { EInsufficientLiquidity }
public fun e_slippage_exceeded(): u64 { ESlippageExceeded }
public fun e_math_overflow(): u64 { EMathOverflow }
```

### Task 3.2: Define `LaunchpadAccount<T>`, `TreasuryCapHolder<T>`, and all events

Append to `launchpad.move`. Match SPEC §4.2, §4.3, §4.7. **Note the linkage fields** — `agent_treasury_id`, `owner_cap_id`, `dwallets_object_id: Option<ID>` (the last is RESERVED for v1.1 Ika).

```move
public struct LaunchpadAccount<phantom T> has key {
    id: UID,
    creator: address,
    linked_identity: Option<sui::object::ID>,
    coin_type_name: String,
    total_supply: u64,
    decimals: u8,

    real_sui_balance: Balance<SUI>,
    real_token_balance: Balance<T>,
    virtual_sui_reserves: u64,
    virtual_token_reserves: u64,

    lp_reserve: Balance<T>,

    nav_sui: Balance<SUI>,
    nav_token: Balance<T>,

    access_threshold: u64,
    accept_coin_payments: bool,
    lifetime_service_revenue_sui: u64,
    cred_revenue_target: u64,

    treasury_cap_holder_id: sui::object::ID,
    agent_treasury_id: sui::object::ID,
    owner_cap_id: sui::object::ID,
    dwallets_object_id: Option<sui::object::ID>,   // RESERVED for v1.1 Ika adapter

    total_buys: u64,
    total_sells: u64,
    total_service_payments_sui: u64,
    total_service_payments_token: u64,
    cumulative_volume_sui: u64,
    cumulative_fees_sui: u64,
    launched_at: u64,
}

public struct TreasuryCapHolder<phantom T> has key {
    id: UID,
    cap: TreasuryCap<T>,
    launchpad_account_id: sui::object::ID,
}

public struct LaunchEvent has copy, drop { /* per SPEC §4.7 */ }
public struct TradeEvent has copy, drop { /* per SPEC §4.7 */ }
public struct FeeDistributedEvent has copy, drop { /* per SPEC §4.7 */ }
public struct ServicePaymentEvent has copy, drop { /* per SPEC §4.7 */ }
public struct AccessConfigEvent has copy, drop { /* per SPEC §4.7 */ }
public struct LinkedIdentityEvent has copy, drop { /* per SPEC §4.7 */ }
```

Plus all the getters (`account_creator`, `account_real_sui`, etc.) used by SDK and tests.

The `public(package) fun holder_cap_mut<T>(h: &mut TreasuryCapHolder<T>): &mut TreasuryCap<T>` accessor used by `fees::distribute_token`.

### Task 3.3: Define `AgentTreasury<T>`, `OwnerCap<T>`, `OperatorCap<T>`

Create: `move/sources/agent_treasury.move`.

```move
module tai::agent_treasury {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::transfer::{Self, Receiving};
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID, ID};
    use std::vector;
    use tai::launchpad::{Self as lp};

    public struct OwnerCap<phantom T> has key, store {
        id: UID,
        agent_treasury_id: ID,
    }

    public struct OperatorCap<phantom T> has key, store {
        id: UID,
        agent_treasury_id: ID,
        daily_limit_sui: u64,
        spent_today_sui: u64,
        epoch_day: u64,
        allowed_targets: vector<address>,
        expires_at_ms: u64,
    }

    public struct AgentTreasury<phantom T> has key {
        id: UID,
        launchpad_account_id: ID,
        owner_cap_id: ID,
        active_operator_cap_ids: vector<ID>,
        sui_balance: Balance<SUI>,
        token_balance: Balance<T>,
    }

    // ---- Events ----
    public struct OperatorCapIssuedEvent has copy, drop {
        agent_treasury_id: ID,
        operator_cap_id: ID,
        recipient: address,
        daily_limit_sui: u64,
        allowed_targets: vector<address>,
        expires_at_ms: u64,
    }
    public struct OperatorCapRevokedEvent has copy, drop { agent_treasury_id: ID, operator_cap_id: ID }
    public struct TreasuryWithdrawEvent has copy, drop {
        agent_treasury_id: ID,
        coin_type: u8,
        amount: u64,
        to: address,
        via: u8,
    }

    // ---- Getters used by tests, SDK, sibling modules ----
    public fun treasury_launchpad_account_id<T>(t: &AgentTreasury<T>): ID { t.launchpad_account_id }
    public fun treasury_owner_cap_id<T>(t: &AgentTreasury<T>): ID { t.owner_cap_id }
    public fun treasury_sui_balance<T>(t: &AgentTreasury<T>): u64 { balance::value(&t.sui_balance) }
    public fun treasury_token_balance<T>(t: &AgentTreasury<T>): u64 { balance::value(&t.token_balance) }
    public fun treasury_active_operator_cap_count<T>(t: &AgentTreasury<T>): u64 { vector::length(&t.active_operator_cap_ids) }
    public fun owner_cap_agent_treasury_id<T>(c: &OwnerCap<T>): ID { c.agent_treasury_id }
    public fun operator_cap_agent_treasury_id<T>(c: &OperatorCap<T>): ID { c.agent_treasury_id }
    public fun operator_cap_daily_limit<T>(c: &OperatorCap<T>): u64 { c.daily_limit_sui }
    public fun operator_cap_spent_today<T>(c: &OperatorCap<T>): u64 { c.spent_today_sui }
    public fun operator_cap_expires_at_ms<T>(c: &OperatorCap<T>): u64 { c.expires_at_ms }

    // ---- Internal constructors (called from tai::launchpad::launch_agent_coin) ----
    public(package) fun build_treasury_owner_and_optional_operator<T>(
        launchpad_account_id: ID,
        owner_cap_recipient: address,
        operator_recipient: Option<address>,
        operator_daily_limit_sui: u64,
        operator_allowed_targets: vector<address>,
        operator_ttl_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): (ID, ID) {
        let treasury_uid = object::new(ctx);
        let treasury_id = object::uid_to_inner(&treasury_uid);
        let owner_cap_uid = object::new(ctx);
        let owner_cap_id = object::uid_to_inner(&owner_cap_uid);

        let owner_cap = OwnerCap<T> {
            id: owner_cap_uid,
            agent_treasury_id: treasury_id,
        };

        let mut treasury = AgentTreasury<T> {
            id: treasury_uid,
            launchpad_account_id,
            owner_cap_id,
            active_operator_cap_ids: vector::empty<ID>(),
            sui_balance: balance::zero<SUI>(),
            token_balance: balance::zero<T>(),
        };

        // Optionally mint an OperatorCap.
        if (option::is_some(&operator_recipient)) {
            let recipient = *option::borrow(&operator_recipient);
            let op_cap_uid = object::new(ctx);
            let op_cap_id = object::uid_to_inner(&op_cap_uid);
            let now = clock::timestamp_ms(clock);
            let expires_at = if (operator_ttl_ms == 0) 0 else now + operator_ttl_ms;
            let op_cap = OperatorCap<T> {
                id: op_cap_uid,
                agent_treasury_id: treasury_id,
                daily_limit_sui: operator_daily_limit_sui,
                spent_today_sui: 0,
                epoch_day: now / 86_400_000,
                allowed_targets: operator_allowed_targets,
                expires_at_ms: expires_at,
            };
            vector::push_back(&mut treasury.active_operator_cap_ids, op_cap_id);

            event::emit(OperatorCapIssuedEvent {
                agent_treasury_id: treasury_id,
                operator_cap_id: op_cap_id,
                recipient,
                daily_limit_sui: operator_daily_limit_sui,
                allowed_targets: operator_allowed_targets,
                expires_at_ms: expires_at,
            });

            transfer::public_transfer(op_cap, recipient);
        };

        transfer::public_transfer(owner_cap, owner_cap_recipient);
        transfer::share_object(treasury);

        (treasury_id, owner_cap_id)
    }
}
```

The constructor is `public(package)` so only `tai::launchpad::launch_agent_coin` can call it. End-user issue/revoke flows come in Phase 8.

Commit: `launchpad: define core structs (LaunchpadAccount, AgentTreasury, OwnerCap, OperatorCap, events)`.

### Task 3.4: Create `tests/test_coin.move` (one-time-witness helper)

```move
#[test_only]
module tai::test_coin {
    use sui::coin;

    public struct TEST_COIN has drop {}

    #[test_only]
    public fun create_for_testing(ctx: &mut sui::tx_context::TxContext): (
        sui::coin::TreasuryCap<TEST_COIN>,
        sui::coin::CoinMetadata<TEST_COIN>,
    ) {
        coin::create_currency(
            TEST_COIN {},
            9,
            b"TEST",
            b"Test Agent Coin",
            b"Test coin for launchpad tests",
            option::none(),
            ctx,
        )
    }
}
```

Commit: `launchpad: TEST_COIN OTW helper for tests`.

---

## Phase 4: `launch_agent_coin` entry function

The single atomic launch: consumes TreasuryCap, mints supply, creates all four shared objects (LaunchpadAccount, TreasuryCapHolder, AgentTreasury) plus OwnerCap (mandatory) and OperatorCap (optional). Emits `LaunchEvent` (and `OperatorCapIssuedEvent` if applicable).

### Task 4.1: Write failing tests in `launchpad_tests.move`

Sovereign mode (default: both recipients = sender):

```move
const CREATOR: address = @0xC1;

#[test]
fun launch_sovereign_mode_creates_all_objects() {
    let mut sc = ts::begin(ADMIN);
    let clock = sui::clock::create_for_testing(ts::ctx(&mut sc));
    lp::init_for_testing(ts::ctx(&mut sc));

    ts::next_tx(&mut sc, CREATOR);
    let (treasury_cap, metadata) = tai::test_coin::create_for_testing(ts::ctx(&mut sc));
    let config = ts::take_shared<lp::LaunchpadConfig>(&sc);

    lp::launch_agent_coin<TEST_COIN>(
        &config,
        treasury_cap,
        &metadata,
        std::string::utf8(b"0xTEST::test_coin::TEST_COIN"),
        option::none<sui::object::ID>(),    // linked_identity
        CREATOR,                            // owner_cap_recipient
        option::none<address>(),            // operator_recipient (none)
        0, vector::empty<address>(), 0,     // operator scope (unused)
        &clock,
        ts::ctx(&mut sc),
    );

    ts::return_shared(config);
    sui::transfer::public_share_object(metadata);

    ts::next_tx(&mut sc, CREATOR);
    let account = ts::take_shared<lp::LaunchpadAccount<TEST_COIN>>(&sc);
    let holder = ts::take_shared<lp::TreasuryCapHolder<TEST_COIN>>(&sc);
    let treasury = ts::take_shared<tai::agent_treasury::AgentTreasury<TEST_COIN>>(&sc);
    let owner_cap = ts::take_from_address<tai::agent_treasury::OwnerCap<TEST_COIN>>(&sc, CREATOR);

    // Linkage invariants
    assert!(lp::account_treasury_cap_holder_id(&account) == sui::object::id(&holder), 0);
    assert!(lp::account_agent_treasury_id(&account) == sui::object::id(&treasury), 1);
    assert!(lp::account_owner_cap_id(&account) == sui::object::id(&owner_cap), 2);
    assert!(option::is_none(&lp::account_dwallets_object_id(&account)), 3);

    assert!(tai::agent_treasury::treasury_launchpad_account_id(&treasury) == sui::object::id(&account), 4);
    assert!(tai::agent_treasury::treasury_owner_cap_id(&treasury) == sui::object::id(&owner_cap), 5);
    assert!(tai::agent_treasury::treasury_active_operator_cap_count(&treasury) == 0, 6);

    // Balances
    assert!(lp::account_real_token(&account) == 800_000_000_000_000_000, 7);
    assert!(lp::account_lp_reserve(&account) == 200_000_000_000_000_000, 8);
    assert!(lp::account_real_sui(&account) == 0, 9);
    assert!(lp::account_nav_sui(&account) == 0, 10);
    assert!(tai::agent_treasury::treasury_sui_balance(&treasury) == 0, 11);

    ts::return_to_address(CREATOR, owner_cap);
    ts::return_shared(account);
    ts::return_shared(holder);
    ts::return_shared(treasury);
    sui::clock::destroy_for_testing(clock);
    ts::end(sc);
}
```

Commissioned mode (different recipients):

```move
const HUMAN: address = @0xH4;
const AGENT_ADDR: address = @0xA61;

#[test]
fun launch_commissioned_mode_distributes_caps_correctly() {
    let mut sc = ts::begin(ADMIN);
    let clock = sui::clock::create_for_testing(ts::ctx(&mut sc));
    lp::init_for_testing(ts::ctx(&mut sc));

    ts::next_tx(&mut sc, HUMAN);
    let (treasury_cap, metadata) = tai::test_coin::create_for_testing(ts::ctx(&mut sc));
    let config = ts::take_shared<lp::LaunchpadConfig>(&sc);

    lp::launch_agent_coin<TEST_COIN>(
        &config, treasury_cap, &metadata,
        std::string::utf8(b"x"),
        option::none(),
        HUMAN,                                                  // owner -> human
        option::some(AGENT_ADDR),                               // operator -> agent
        10_000_000_000, vector::empty<address>(), 30 * 86_400_000,
        &clock, ts::ctx(&mut sc),
    );
    ts::return_shared(config);
    sui::transfer::public_share_object(metadata);

    ts::next_tx(&mut sc, HUMAN);
    let owner_cap = ts::take_from_address<tai::agent_treasury::OwnerCap<TEST_COIN>>(&sc, HUMAN);
    let op_cap = ts::take_from_address<tai::agent_treasury::OperatorCap<TEST_COIN>>(&sc, AGENT_ADDR);

    let treasury = ts::take_shared<tai::agent_treasury::AgentTreasury<TEST_COIN>>(&sc);
    assert!(tai::agent_treasury::treasury_active_operator_cap_count(&treasury) == 1, 0);
    assert!(tai::agent_treasury::operator_cap_daily_limit(&op_cap) == 10_000_000_000, 1);

    ts::return_to_address(HUMAN, owner_cap);
    ts::return_to_address(AGENT_ADDR, op_cap);
    ts::return_shared(treasury);
    sui::clock::destroy_for_testing(clock);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = tai::launchpad::ETreasuryCapNotEmpty)]
fun launch_aborts_if_cap_already_minted() {
    // ... construct a TreasuryCap, mint some, then call launch -> abort
}
```

### Task 4.2: Implement `launch_agent_coin`

```move
public entry fun launch_agent_coin<T>(
    config: &LaunchpadConfig,
    mut treasury_cap: TreasuryCap<T>,
    _metadata: &CoinMetadata<T>,
    coin_type_name: String,
    linked_identity: Option<sui::object::ID>,
    owner_cap_recipient: address,
    operator_recipient: Option<address>,
    operator_daily_limit_sui: u64,
    operator_allowed_targets: vector<address>,
    operator_ttl_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(coin::total_supply(&treasury_cap) == 0, ETreasuryCapNotEmpty);

    let sender = tx_context::sender(ctx);
    let sale_supply = config.sale_supply;
    let lp_supply = config.lp_supply;
    let total_supply = sale_supply + lp_supply;

    let sale_coin = coin::mint(&mut treasury_cap, sale_supply, ctx);
    let lp_coin = coin::mint(&mut treasury_cap, lp_supply, ctx);

    let now = clock::timestamp_ms(clock);

    // Allocate IDs for cross-linkage.
    let account_uid = object::new(ctx);
    let account_id = object::uid_to_inner(&account_uid);
    let holder_uid = object::new(ctx);
    let holder_id = object::uid_to_inner(&holder_uid);

    // Build treasury, mint OwnerCap, optionally mint OperatorCap.
    // Returns (treasury_id, owner_cap_id).
    let (treasury_id, owner_cap_id) = tai::agent_treasury::build_treasury_owner_and_optional_operator<T>(
        account_id,
        owner_cap_recipient,
        operator_recipient,
        operator_daily_limit_sui,
        operator_allowed_targets,
        operator_ttl_ms,
        clock,
        ctx,
    );

    // Build and share TreasuryCapHolder.
    let cap_holder = TreasuryCapHolder<T> {
        id: holder_uid,
        cap: treasury_cap,
        launchpad_account_id: account_id,
    };

    let account = LaunchpadAccount<T> {
        id: account_uid,
        creator: sender,
        linked_identity,
        coin_type_name,
        total_supply,
        decimals: 9,
        real_sui_balance: balance::zero<SUI>(),
        real_token_balance: coin::into_balance(sale_coin),
        virtual_sui_reserves: config.virtual_sui_reserves,
        virtual_token_reserves: config.virtual_token_reserves,
        lp_reserve: coin::into_balance(lp_coin),
        nav_sui: balance::zero<SUI>(),
        nav_token: balance::zero<T>(),
        access_threshold: 0,
        accept_coin_payments: false,
        lifetime_service_revenue_sui: 0,
        cred_revenue_target: config.cred_revenue_target,
        treasury_cap_holder_id: holder_id,
        agent_treasury_id: treasury_id,
        owner_cap_id,
        dwallets_object_id: option::none<sui::object::ID>(),
        total_buys: 0,
        total_sells: 0,
        total_service_payments_sui: 0,
        total_service_payments_token: 0,
        cumulative_volume_sui: 0,
        cumulative_fees_sui: 0,
        launched_at: now,
    };

    event::emit(LaunchEvent {
        launchpad_id: account_id,
        agent_treasury_id: treasury_id,
        owner_cap_id,
        treasury_cap_holder_id: holder_id,
        coin_type_name: account.coin_type_name,
        creator: sender,
        linked_identity: account.linked_identity,
        timestamp: now,
    });

    transfer::share_object(cap_holder);
    transfer::share_object(account);
}
```

Run tests → PASS. Commit: `launchpad: launch_agent_coin creates LaunchpadAccount + AgentTreasury + OwnerCap (+ optional OperatorCap)`.

---

## Phase 5: Fees module

Single config-agnostic `compute_split(total, nav_bps, creator_bps)` plus two distribution functions (`distribute_sui`, `distribute_token<T>`). All math in `u128`. **`tai::fees` does NOT import `tai::launchpad`** — keeping it independent is what lets Phase 6 import `tai::fees` from launchpad without creating a dependency cycle. Callers (buy / sell / record_service_payment_*) read their fee bps off `LaunchpadConfig` and pass them in.

### Task 5.1: Failing tests for the split

Test against default config bps pulled via `lp::config_*` getters:
- Trade split (30/60/10) on 1M MIST.
- Service-SUI split (40/50/10) on 1M MIST.
- Token-service split (40/10/50 nav/creator/burn) on 1M base units.
- Large-input no-overflow (1e17 MIST).
- Total=1 with 30/60/10 → (0, 0, 1) (remainder routing).

### Task 5.2: Implement `fees.move`

```move
module tai::fees {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, TreasuryCap};
    use sui::sui::SUI;
    // NB: do NOT import tai::launchpad here — that creates a dep cycle with Phase 6.

    public struct Split has copy, drop { nav: u64, creator: u64, platform_or_burn: u64 }

    public fun compute_split(total: u64, nav_bps: u64, creator_bps: u64): Split { ... }
    public fun distribute_sui(fee_balance, s, nav_target, creator_addr, platform_addr, ctx) { ... }
    public fun distribute_token<T>(payment_balance, s, nav_target_token, cap: &mut TreasuryCap<T>, creator_addr, ctx) { ... }
}
```

`distribute_token` takes `&mut TreasuryCap<T>` directly (not the wrapper). In Phase 6+ callers (`record_service_payment_token`) extract it via `lp::holder_cap_mut(holder)` and pass.

Run tests → PASS. Commit: `launchpad: fees module with compute_split + sui/token distribution`.

---

## Phase 6: Buy and Sell

### Task 6.1: buy entry function

Tests: success-path balance assertions; slippage trip (`ESlippageExceeded`); insufficient liquidity (very large min_out → trip).

Implementation per SPEC §5.3 buy. Takes `&LaunchpadConfig` (immutable). Uses `bonding_curve::compute_buy` and `fees::distribute_sui` with trade-fee shares.

Commit: `launchpad: buy entry function with slippage and liquidity guards`.

### Task 6.2: sell entry function

Symmetric. Tests: success-path; slippage trip; large-tokens-in attempt that would empty real SUI → liquidity error.

Implementation per SPEC §5.3 sell.

Commit: `launchpad: sell entry function`.

---

## Phase 7: Service payments

### Task 7.1: record_service_payment_sui

Tests:
1. Non-creator payer → NAV grows, `lifetime_service_revenue_sui` grows.
2. Creator self-payment → NAV grows, `lifetime_service_revenue_sui` does NOT grow.

Implementation per SPEC §5.4.1.

Commit: `launchpad: record_service_payment_sui with self-pump exclusion`.

### Task 7.2: record_service_payment_token (with burn)

Tests:
1. With `accept_coin_payments = true` → `nav_token` grows; total supply decreases by burn amount.
2. With `accept_coin_payments = false` → `ECoinPaymentsDisabled`.
3. With mismatched TreasuryCapHolder → `ELaunchpadMismatch`.

Implementation per SPEC §5.4.2. Takes `&mut TreasuryCapHolder<T>` for burn. Asserts bidirectional linkage.

Commit: `launchpad: record_service_payment_token with burn via TreasuryCapHolder`.

---

## Phase 8: Treasury operations

`tai::agent_treasury` gains end-user entry functions: withdraw (OwnerCap-gated), top-up, claim-received, OperatorCap issue / revoke / spend.

### Task 8.1: OwnerCap-gated withdrawals

Tests:
- `withdraw_sui` from valid OwnerCap holder → SUI moves, treasury balance drops.
- `withdraw_sui` with foreign OwnerCap (for different treasury) → `ENotOwnerCap`.
- `withdraw_token` symmetric.

Implementation:

```move
public entry fun withdraw_sui<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    amount: u64,
    to: address,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.agent_treasury_id == object::id(treasury), lp::e_not_owner_cap());
    let payout = balance::split(&mut treasury.sui_balance, amount);
    transfer::public_transfer(sui::coin::from_balance(payout, ctx), to);

    event::emit(TreasuryWithdrawEvent {
        agent_treasury_id: object::id(treasury),
        coin_type: 0,
        amount,
        to,
        via: 0,
    });
}

public entry fun withdraw_token<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    amount: u64,
    to: address,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.agent_treasury_id == object::id(treasury), lp::e_not_owner_cap());
    let payout = balance::split(&mut treasury.token_balance, amount);
    transfer::public_transfer(sui::coin::from_balance(payout, ctx), to);

    event::emit(TreasuryWithdrawEvent {
        agent_treasury_id: object::id(treasury),
        coin_type: 1,
        amount,
        to,
        via: 0,
    });
}
```

Commit: `agent_treasury: OwnerCap-gated withdrawals (SUI + token)`.

### Task 8.2: Top-up + claim-received

Tests:
- `top_up_sui` from any sender → balance grows.
- `claim_received_sui` after a `transfer-to-object` → balance grows.

Implementation:

```move
public entry fun top_up_sui<T>(treasury: &mut AgentTreasury<T>, payment: Coin<SUI>) {
    balance::join(&mut treasury.sui_balance, sui::coin::into_balance(payment));
}

public entry fun top_up_token<T>(treasury: &mut AgentTreasury<T>, payment: Coin<T>) {
    balance::join(&mut treasury.token_balance, sui::coin::into_balance(payment));
}

public entry fun claim_received_sui<T>(
    treasury: &mut AgentTreasury<T>,
    receiving: Receiving<Coin<SUI>>,
) {
    let coin = transfer::public_receive(&mut treasury.id, receiving);
    balance::join(&mut treasury.sui_balance, sui::coin::into_balance(coin));
}

public entry fun claim_received_token<T>(
    treasury: &mut AgentTreasury<T>,
    receiving: Receiving<Coin<T>>,
) {
    let coin = transfer::public_receive(&mut treasury.id, receiving);
    balance::join(&mut treasury.token_balance, sui::coin::into_balance(coin));
}
```

Arbitrary `Coin<X>` claiming via dynamic fields is deferred to v1.1 — for v1 only SUI and the agent's own T are typed; other coins remain in the treasury's address inventory until v1.1 ships the generic claim helper.

Commit: `agent_treasury: top-up and transfer-to-object claim entry functions`.

### Task 8.3: OperatorCap issue / revoke

Tests:
- `issue_operator_cap` from valid OwnerCap → cap minted, active set grows, event emitted, cap arrives at recipient.
- `issue_operator_cap` with foreign OwnerCap → `ENotOwnerCap`.
- `revoke_operator_cap` removes ID from active set; emits event.

Implementation:

```move
public entry fun issue_operator_cap<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    recipient: address,
    daily_limit_sui: u64,
    allowed_targets: vector<address>,
    ttl_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(owner_cap.agent_treasury_id == object::id(treasury), lp::e_not_owner_cap());

    let now = clock::timestamp_ms(clock);
    let expires_at = if (ttl_ms == 0) 0 else now + ttl_ms;

    let op_cap_uid = object::new(ctx);
    let op_cap_id = object::uid_to_inner(&op_cap_uid);
    let op_cap = OperatorCap<T> {
        id: op_cap_uid,
        agent_treasury_id: object::id(treasury),
        daily_limit_sui,
        spent_today_sui: 0,
        epoch_day: now / 86_400_000,
        allowed_targets,
        expires_at_ms: expires_at,
    };

    vector::push_back(&mut treasury.active_operator_cap_ids, op_cap_id);

    event::emit(OperatorCapIssuedEvent {
        agent_treasury_id: object::id(treasury),
        operator_cap_id: op_cap_id,
        recipient,
        daily_limit_sui,
        allowed_targets,
        expires_at_ms: expires_at,
    });

    transfer::public_transfer(op_cap, recipient);
}

public entry fun revoke_operator_cap<T>(
    treasury: &mut AgentTreasury<T>,
    owner_cap: &OwnerCap<T>,
    cap_id: ID,
) {
    assert!(owner_cap.agent_treasury_id == object::id(treasury), lp::e_not_owner_cap());

    let (found, idx) = vector::index_of(&treasury.active_operator_cap_ids, &cap_id);
    assert!(found, lp::e_operator_cap_revoked());
    vector::remove(&mut treasury.active_operator_cap_ids, idx);

    event::emit(OperatorCapRevokedEvent { agent_treasury_id: object::id(treasury), operator_cap_id: cap_id });
}
```

Commit: `agent_treasury: OperatorCap issue and revoke (OwnerCap-gated)`.

### Task 8.4: operator_spend_sui

The policy-enforced spend. Tests:
1. Spend within scope → success; balance moves; `spent_today_sui` increments.
2. Spend exceeding `daily_limit_sui` → `EOperatorDailyLimitExceeded`.
3. Spend to non-allowlisted target → `EOperatorTargetNotAllowed`.
4. Spend after `expires_at_ms` → `EOperatorCapExpired`.
5. Spend after revocation → `EOperatorCapRevoked`.
6. Two spends on the same UTC day accumulate against the limit; spend on a new day resets and uses the full limit.

Implementation:

```move
public entry fun operator_spend_sui<T>(
    treasury: &mut AgentTreasury<T>,
    op_cap: &mut OperatorCap<T>,
    amount: u64,
    to: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(op_cap.agent_treasury_id == object::id(treasury), lp::e_not_operator_cap());

    // Revocation check.
    let (found, _) = vector::index_of(&treasury.active_operator_cap_ids, &object::id(op_cap));
    assert!(found, lp::e_operator_cap_revoked());

    // TTL check.
    let now = clock::timestamp_ms(clock);
    if (op_cap.expires_at_ms != 0) {
        assert!(now < op_cap.expires_at_ms, lp::e_operator_cap_expired());
    };

    // Allowlist check.
    assert!(vector::contains(&op_cap.allowed_targets, &to), lp::e_operator_target_not_allowed());

    // Daily epoch rollover.
    let current_day = now / 86_400_000;
    if (current_day > op_cap.epoch_day) {
        op_cap.epoch_day = current_day;
        op_cap.spent_today_sui = 0;
    };

    // Daily limit check.
    assert!(op_cap.spent_today_sui + amount <= op_cap.daily_limit_sui, lp::e_operator_daily_limit_exceeded());
    op_cap.spent_today_sui = op_cap.spent_today_sui + amount;

    // Move SUI.
    let payout = balance::split(&mut treasury.sui_balance, amount);
    transfer::public_transfer(sui::coin::from_balance(payout, ctx), to);

    event::emit(TreasuryWithdrawEvent {
        agent_treasury_id: object::id(treasury),
        coin_type: 0,
        amount,
        to,
        via: 1,
    });
}
```

A symmetric `operator_spend_token<T>` follows the same pattern but takes from `treasury.token_balance`. The daily limit is still SUI-denominated for v1 — token-denominated limits are v1.5 (require per-cap unit tracking).

Actually for v1, just gate `operator_spend_token<T>` on the allowlist + TTL + revocation checks and leave a no-limit / hard-coded zero limit for token spend. Document the limitation. Alternative: add a separate `daily_limit_token` field — but that adds OperatorCap surface for marginal v1 benefit. **Decision: v1 ships `operator_spend_sui` only; `operator_spend_token` is v1.1.**

Commit: `agent_treasury: operator_spend_sui with daily limit, allowlist, TTL, revocation enforcement`.

---

## Phase 9: Access config + linked identity + views

### Task 9.1: set_access_config + set_linked_identity

Per SPEC §5.8. Creator-only (sender == `account.creator`). Tests for success + abort on non-creator.

Commit: `launchpad: set_access_config and set_linked_identity (creator-only)`.

### Task 9.2: views::effective_hire_price

Create `move/sources/views.move`. Tests at zero revenue (→ 1.0x), at `cred_revenue_target` (→ 2.0x), at 2× target (still 2.0x), plus the `hire_quote` aggregate view returning all five fields.

Implementation per SPEC §5.7.

Commit: `launchpad: self-referential effective_hire_price and hire_quote views`.

---

## Phase 10: Self-review and testnet publish

### Task 10.1: Run full test suite

- [ ] `cd Tai-Launchpad/move && sui move test` → all pass.
- [ ] `sui move build` → no warnings.
- [ ] Run the Self-Review Checklist at the bottom of this file. Every box checkable.

### Task 10.2: Publish to testnet

- [ ] Confirm gas: `sui client gas` (need ≥1 SUI).
- [ ] `sui client publish --gas-budget 200000000`.
- [ ] Save package + config IDs to `Tai-Launchpad/move/published.json`.

### Task 10.3: Manual smoke test on testnet

- [ ] Publish an OTW coin module via `sui client publish`. Capture TreasuryCap + CoinMetadata IDs.
- [ ] `sui client call tai::launchpad::launch_agent_coin` with sovereign-mode args (both recipients = your address). Confirm 4 shared objects + 1 OwnerCap created.
- [ ] Buy 0.1 SUI worth. Confirm `nav_sui > 0`.
- [ ] Pay 0.05 SUI as service payment from a second address. Confirm `lifetime_service_revenue_sui` grew.
- [ ] `set_access_config` to enable coin payments. Pay 1k tokens via `record_service_payment_token`. Confirm burn (total supply dropped).
- [ ] Call `issue_operator_cap` from your address. Confirm OperatorCap minted to recipient.
- [ ] Call `operator_spend_sui` with that cap. Confirm SUI transferred; revocation/limit/TTL tests by direct contract call.
- [ ] `tai::views::hire_quote` via `devInspect` returns matching state.

---

## Phase 11: `tai-core` Rust crate

Single source of truth for both `tai-cli` and the WASM-backed TS SDK.

### Task 11.1: Workspace scaffold

Create: `Tai-Launchpad/rust/Cargo.toml` (workspace), `rust/tai-core/Cargo.toml`, `rust/tai-core/src/lib.rs`.

```toml
# Tai-Launchpad/rust/Cargo.toml
[workspace]
members = ["tai-core", "tai-cli"]
resolver = "2"

[workspace.package]
edition = "2021"
version = "0.1.0"
license = "MIT"

[workspace.dependencies]
sui-sdk = { git = "https://github.com/MystenLabs/sui.git", rev = "95cddc3f5", package = "sui-sdk" }
sui-types = { git = "https://github.com/MystenLabs/sui.git", rev = "95cddc3f5", package = "sui-types" }
sui-keys = { git = "https://github.com/MystenLabs/sui.git", rev = "95cddc3f5", package = "sui-keys" }
shared-crypto = { git = "https://github.com/MystenLabs/sui.git", rev = "95cddc3f5" }
move-core-types = { git = "https://github.com/MystenLabs/sui.git", rev = "95cddc3f5" }

tokio = { version = "1", features = ["full"] }
anyhow = "1"
thiserror = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive", "env"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
bcs = "0.1"
hex = "0.4"
tracing = "0.1"
tracing-subscriber = "0.3"
```

```toml
# Tai-Launchpad/rust/tai-core/Cargo.toml
[package]
name = "tai-core"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
sui-sdk.workspace = true
sui-types.workspace = true
sui-keys.workspace = true
shared-crypto.workspace = true
move-core-types.workspace = true
tokio.workspace = true
anyhow.workspace = true
thiserror.workspace = true
serde.workspace = true
serde_json.workspace = true
reqwest.workspace = true
bcs.workspace = true
hex.workspace = true
tracing.workspace = true
```

- [ ] `cargo build` → workspace compiles.
- [ ] Commit: `tai-core: workspace + crate scaffold`.

### Task 11.2: Module structure

```
tai-core/src/
├── lib.rs              // pub mod re-exports
├── config.rs           // network / package_id / config_id state
├── error.rs            // TaiError enum
├── signer.rs           // Signer trait + 4 impls
├── ptb.rs              // PTB builders for each entry function
├── client.rs           // TaiClient (high-level facade over PTB + signing + execution)
├── reads.rs            // SuiObject readers for LaunchpadAccount / AgentTreasury / caps
├── coin_template.rs    // OTW coin module bytecode templater
└── indexer.rs          // event stream client
```

`lib.rs`:

```rust
pub mod client;
pub mod coin_template;
pub mod config;
pub mod error;
pub mod indexer;
pub mod ptb;
pub mod reads;
pub mod signer;

pub use client::TaiClient;
pub use config::{Network, TaiConfig};
pub use error::TaiError;
pub use signer::{Ed25519FileSigner, Signer, SuiKeystoreSigner, TeeSigner, TurnkeySigner};
```

Commit: `tai-core: module skeleton`.

### Task 11.3: Signer trait + 4 implementations

```rust
// signer.rs
use anyhow::Result;
use async_trait::async_trait;
use sui_types::{base_types::SuiAddress, crypto::Signature, transaction::TransactionData};

#[async_trait]
pub trait Signer: Send + Sync {
    fn address(&self) -> SuiAddress;
    async fn sign_transaction(&self, tx_data: &TransactionData) -> Result<Signature>;
}

pub struct Ed25519FileSigner { /* key bytes loaded from disk */ }
pub struct SuiKeystoreSigner { /* wraps ~/.sui/sui_config/sui.keystore */ }
pub struct TurnkeySigner { /* HTTP client to api.turnkey.com */ }
pub struct TeeSigner { /* HTTP client to a Phala Cloud / Nautilus endpoint exposing attestation */ }

impl Signer for Ed25519FileSigner { /* ... */ }
impl Signer for SuiKeystoreSigner { /* ... */ }
impl Signer for TurnkeySigner { /* ... */ }
impl Signer for TeeSigner {
    // Must:
    // 1. Send tx_data hash to TEE endpoint.
    // 2. Receive signature + attestation report.
    // 3. Optionally verify attestation report against published measurement.
    // 4. Return Signature.
}
```

Tests: unit tests for each signer's `address()` method; integration tests that produce a Sui-valid signature against testnet for at least the Ed25519FileSigner.

Commit: `tai-core: Signer trait with Ed25519File / SuiKeystore / Turnkey / TEE implementations`.

### Task 11.4: PTB builders

For each Move entry function, a function that constructs the corresponding `Transaction`:

```rust
// ptb.rs
use sui_sdk::types::transaction::Transaction;

pub fn build_launch_agent_coin_ptb(
    config: &TaiConfig,
    treasury_cap_id: ObjectId,
    coin_metadata_id: ObjectId,
    coin_type: &str,
    coin_type_name: &str,
    linked_identity: Option<ObjectId>,
    owner_cap_recipient: SuiAddress,
    operator_recipient: Option<SuiAddress>,
    operator_daily_limit_sui: u64,
    operator_allowed_targets: Vec<SuiAddress>,
    operator_ttl_ms: u64,
    self_buy_sui: Option<u64>,
    self_buy_min_out: u64,
) -> Transaction { /* ... */ }

pub fn build_buy_ptb(...) -> Transaction { /* ... */ }
pub fn build_sell_ptb(...) -> Transaction { /* ... */ }
pub fn build_service_payment_sui_ptb(...) -> Transaction { /* ... */ }
pub fn build_service_payment_token_ptb(...) -> Transaction { /* ... */ }
pub fn build_set_access_config_ptb(...) -> Transaction { /* ... */ }
pub fn build_set_linked_identity_ptb(...) -> Transaction { /* ... */ }
pub fn build_withdraw_sui_ptb(...) -> Transaction { /* ... */ }
pub fn build_withdraw_token_ptb(...) -> Transaction { /* ... */ }
pub fn build_top_up_sui_ptb(...) -> Transaction { /* ... */ }
pub fn build_claim_received_sui_ptb(...) -> Transaction { /* ... */ }
pub fn build_issue_operator_cap_ptb(...) -> Transaction { /* ... */ }
pub fn build_revoke_operator_cap_ptb(...) -> Transaction { /* ... */ }
pub fn build_operator_spend_sui_ptb(...) -> Transaction { /* ... */ }
```

Tests: each builder produces a valid PTB serialization (BCS round-trip) and references the correct Move target.

Commit: `tai-core: PTB builders for every Tai Move entry function`.

### Task 11.5: TaiClient facade

```rust
// client.rs
pub struct TaiClient {
    sui: SuiClient,
    config: TaiConfig,
    signer: Box<dyn Signer>,
}

impl TaiClient {
    pub async fn launch(
        &self,
        params: LaunchParams,
    ) -> Result<LaunchOutput, TaiError> {
        // Two-tx flow:
        // 1. Templater builds coin module bytecode.
        // 2. Publish tx (sponsored if config.sponsored_gas).
        // 3. Extract TreasuryCap + CoinMetadata object IDs from objectChanges.
        // 4. Build launch_agent_coin PTB; optionally chain a buy.
        // 5. Execute. Parse LaunchEvent + AgentTreasury IDs from effects.
        // 6. Return all object IDs as LaunchOutput.
    }

    pub async fn buy(&self, ...) -> Result<TradeOutput, TaiError> { ... }
    pub async fn sell(&self, ...) -> Result<TradeOutput, TaiError> { ... }
    pub async fn pay_sui(&self, ...) -> Result<(), TaiError> { ... }
    pub async fn pay_token(&self, ...) -> Result<(), TaiError> { ... }
    pub async fn withdraw_sui(&self, ...) -> Result<(), TaiError> { ... }
    pub async fn issue_operator_cap(&self, ...) -> Result<ObjectId, TaiError> { ... }
    pub async fn revoke_operator_cap(&self, ...) -> Result<(), TaiError> { ... }
    pub async fn operator_spend_sui(&self, ...) -> Result<(), TaiError> { ... }
    pub async fn get_account(&self, launchpad_id: ObjectId) -> Result<LaunchpadAccountView, TaiError> { ... }
    pub async fn get_treasury(&self, treasury_id: ObjectId) -> Result<AgentTreasuryView, TaiError> { ... }
    pub async fn hire_quote(&self, launchpad_id: ObjectId) -> Result<HireQuoteView, TaiError> { ... }
}
```

Integration tests against testnet: full launch → buy → sell → service payment → quote round-trip with all four signer types (where credentials available).

Commit: `tai-core: TaiClient facade with full lifecycle methods`.

### Task 11.6: OTW coin module templater

`coin_template.rs` takes `(name, symbol, decimals, icon_url)` and produces Move bytecode for a one-time-witness coin module ready to publish. Two implementations options:

**Option A (recommended):** ship a small Move template at `tai-core/templates/coin.move.tmpl`, perform string substitution, then compile via `move-build` (called as a library). Output is bytecode bytes ready for `tx.publish(...)`.

**Option B (faster):** ship pre-built bytecode skeleton, patch identifiers in place. Brittle but no compilation dependency.

Default to Option A. Cache compiled bytecode by template hash for repeat launches.

Tests: produce bytecode for a sample template; verify `coin::total_supply(treasury_cap) == 0` after a publish-and-deserialize round-trip.

Commit: `tai-core: OTW coin module templater (Move-build path)`.

### Task 11.7: Indexer client (basic)

A minimal event-stream client that subscribes to `LaunchEvent`, `TradeEvent`, `ServicePaymentEvent` for a given launchpad ID. Uses Sui RPC's `subscribeEvent`. Returns a stream of typed events.

Tests against testnet: subscribe to a launched LaunchpadAccount, emit a known TradeEvent, verify it arrives in the stream.

Commit: `tai-core: indexer client for event subscription`.

---

## Phase 12: `tai-cli` binary

The agent-native primary access surface.

### Task 12.1: CLI scaffold + argument parsing

Create `Tai-Launchpad/rust/tai-cli/Cargo.toml`:

```toml
[package]
name = "tai-cli"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "tai"
path = "src/main.rs"

[dependencies]
tai-core = { path = "../tai-core" }
clap.workspace = true
tokio.workspace = true
anyhow.workspace = true
serde.workspace = true
serde_json.workspace = true
atty = "0.2"
```

`src/main.rs` + a `cmd/` subdirectory with one file per command tree (`init`, `status`, `launch`, `buy`, `sell`, `pay`, `treasury`, `op`, `access`, `quote`, `account`, `find`, `watch`, `config`).

Use `clap` derive macros for the top-level command tree. All subcommands honor a global `--output {auto,json,pretty}` flag (default `auto`: JSON when piped, pretty when TTY). All subcommands accept env-var fallbacks for IDs.

- [ ] `cargo build` → `target/debug/tai` binary exists.
- [ ] `target/debug/tai --help` → renders the full command tree.
- [ ] Commit: `tai-cli: clap-based command tree scaffold`.

### Task 12.2: `tai init` and `tai status`

`init` writes `~/.tai/config.toml`:

```toml
network = "testnet"
package_id = "0x..."
config_id = "0x..."
rpc_url = "https://fullnode.testnet.sui.io"

[signer]
mode = "sui-keystore"     # or "ed25519" | "turnkey" | "tee"
# mode-specific fields follow
```

Interactive prompts only when the user did not pass flags. With `--non-interactive`, requires every value as a flag.

`status` reads config, resolves active address from the configured signer, queries gas balance, prints summary.

Tests: `tai init --non-interactive --network testnet --signer-mode sui-keystore` writes the expected TOML. `tai status` reads it and prints address + balance.

Commit: `tai-cli: init and status commands`.

### Task 12.3: `tai launch`

The headline command. Flags:

- `--name`, `--symbol`, `--image-blob`, `--description`, `--external-url`
- `--linked-identity` (optional)
- `--owner-cap-recipient` (default: signer address)
- `--operator-cap-recipient` (optional; default: none → no OperatorCap minted at launch)
- `--operator-daily-limit-sui`, `--operator-allowlist` (CSV), `--operator-ttl-days`
- `--self-buy-sui` (default: 0)
- `--sponsored` (default: true) — uses Tai-platform-sponsored gas

Calls `TaiClient::launch(...)`. Emits one JSON record with every relevant object ID on success.

Tests: launch a sovereign-mode agent on testnet; verify the published object IDs come back and the LaunchpadAccount is queryable via `sui client object`.

Commit: `tai-cli: launch command (two-tx flow with optional self-buy)`.

### Task 12.4: Trade + service-payment commands

- `tai buy --launchpad <ID> --coin-type <T> --amount-sui <N> --min-out <N>`
- `tai sell --launchpad <ID> --coin-type <T> --amount-tokens <N> --min-sui <N>`
- `tai pay sui --launchpad <ID> --coin-type <T> --payment-coin <COIN_ID>`
- `tai pay token --launchpad <ID> --treasury-cap-holder <ID> --coin-type <T> --payment-coin <COIN_ID>`

Each is ~30 lines of CLI glue calling the corresponding `TaiClient` method.

Commit: `tai-cli: buy, sell, pay sui, pay token`.

### Task 12.5: Treasury and OperatorCap commands

- `tai treasury show --treasury <ID> --coin-type <T>`
- `tai treasury withdraw-sui --treasury <ID> --owner-cap <ID> --amount <N> --to <ADDR>`
- `tai treasury top-up --treasury <ID> --coin <COIN_ID>` (auto-detects SUI vs T)
- `tai op issue --treasury <ID> --owner-cap <ID> --recipient <ADDR> --daily-limit <N> --allowlist <CSV> --ttl-days <N>`
- `tai op revoke --treasury <ID> --owner-cap <ID> --cap-id <ID>`
- `tai op list --treasury <ID>` (reads `active_operator_cap_ids`)
- `tai op spend-sui --treasury <ID> --operator-cap <ID> --amount <N> --to <ADDR>`

Commit: `tai-cli: treasury + operator-cap commands`.

### Task 12.6: Access, quote, and account inspection

- `tai access threshold --launchpad <ID> --coin-type <T> --value <N>` (creator-only)
- `tai access coin-payments --launchpad <ID> --coin-type <T> --enable | --disable`
- `tai access linked-identity --launchpad <ID> --coin-type <T> --identity <ID|none>`
- `tai quote --launchpad <ID> --coin-type <T>` — calls `hire_quote` view
- `tai account show --launchpad <ID> --coin-type <T>` — full dump as JSON

Commit: `tai-cli: access, quote, account commands`.

### Task 12.7: Discovery + watch

- `tai find [--min-cred-bps N] [--max-access-threshold N] [--coin-payments-enabled] [--limit N]` — queries the indexer's REST endpoint (deferred indexer is OK in v1; fallback to a basic Sui RPC `getOwnedObjects` scan + filter)
- `tai watch service-payments --launchpad <ID>` — opens an event subscription via `tai-core::indexer`, streams matching events to stdout

Commit: `tai-cli: find and watch commands`.

### Task 12.8: TEE signer integration (Phala Cloud + Nautilus)

Concrete implementation of `TeeSigner` in `tai-core/src/signer.rs` (Phase 11.3 stubbed it). Talks to a Phala Cloud TEE that holds the signing key and produces a Nautilus attestation report on every signature.

- HTTP endpoint contract: `POST /sign { tx_hash, request_id }` → `{ signature, attestation_report, public_key }`.
- Attestation verification: download Nautilus measurement from Mysten's published registry; compare against the report's measurement field; abort if mismatch.
- CLI surface: `tai init --signer-mode tee --tee-endpoint <URL> --tee-measurement-hash <HEX>`.

A reference TEE-host script lives at `Tai-Launchpad/examples/tee-host/` — a minimal Phala Cloud worker that loads a sealed Ed25519 key on boot, exposes the `POST /sign` endpoint, and produces attestation reports via the Phala Cloud SDK.

Integration test: bring up the example TEE worker locally (Phala Cloud test mode), launch an agent via `tai launch` with `--signer-mode tee`, verify the launch succeeds and the attestation report verifies against the published measurement.

Commit: `tai-cli + tai-core: TEE signer (Phala Cloud + Nautilus attestation)`.

### Task 12.9: Release engineering

- GitHub Actions workflow builds release binaries for `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`.
- Each binary is SHA256-signed; signatures published alongside.
- `install.sh` script in `Tai-Launchpad/scripts/install.sh` — detects platform, downloads + verifies the matching binary.
- Docker image `Tai-Launchpad/docker/Dockerfile`: scratch base + statically-linked binary. Pushed to `ghcr.io/<org>/tai-cli`.
- Homebrew formula `Tai-Launchpad/brew/Formula/tai.rb` for `brew tap <gh-handle>/tai && brew install tai`.

- [ ] Build pipeline runs on push to main.
- [ ] Manual test: `curl -sSf https://raw.githubusercontent.com/<org>/tai/main/scripts/install.sh | sh` installs and runs.
- [ ] Commit: `tai-cli: release engineering (binaries, docker, brew, install script)`.

---

## Phase 13: TypeScript SDK via WASM

### Task 13.1: WASM target for tai-core

Add to `tai-core/Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[target.'cfg(target_arch = "wasm32")'.dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"
serde-wasm-bindgen = "0.6"
```

Build via `wasm-pack build --target web --out-dir ../sdk/pkg`.

Stub out features that don't compile in WASM (e.g., file I/O for `Ed25519FileSigner`) behind `cfg(not(target_arch = "wasm32"))`.

Commit: `tai-core: wasm32 target with wasm-bindgen exports`.

### Task 13.2: `@tai/sdk` TypeScript wrapper

Create `Tai-Launchpad/sdk/`:

```
sdk/
├── package.json     // name: @<scope>/sdk
├── tsconfig.json
├── pkg/             // wasm-pack output (gitignored, built in CI)
├── src/
│   ├── index.ts
│   ├── client.ts    // idiomatic TS wrapper around the WASM exports
│   ├── signer.ts    // browser-friendly signer impls (zkLogin, Passkey, wallet adapters)
│   └── types.ts     // TS interface definitions (LaunchpadAccount, AgentTreasury, etc.)
└── tests/
    └── integration.test.ts
```

`client.ts` exposes the same shape as the Rust `TaiClient` but typed for TS consumers and using the browser-friendly signers.

Commit: `@tai/sdk: TypeScript wrapper over tai-core WASM`.

### Task 13.3: SDK integration test against testnet

Test scenario: launch → buy → quote → service payment → withdraw, all from the SDK. Uses a hot-key signer (Ed25519 generated for the test). Confirms the WASM path produces identical results to the native CLI.

Commit: `@tai/sdk: integration smoke test against testnet`.

---

## Phase 14: Examples + docs (CLI-first)

### Task 14.1: CLI quickstart (`Tai-Launchpad/examples/cli-quickstart/`)

A shell script that walks through the full lifecycle on testnet using only `tai` commands. Documented inline.

```bash
#!/bin/sh
set -euo pipefail

tai init --non-interactive --network testnet --signer-mode sui-keystore

LAUNCH=$(tai launch \
  --name "Demo Agent" \
  --symbol DEMO \
  --image-blob 0xdeadbeef \
  --self-buy-sui 500000000 \
  --output json)

LAUNCHPAD=$(echo "$LAUNCH" | jq -r .launchpad_id)
TREASURY=$(echo "$LAUNCH" | jq -r .agent_treasury_id)
OWNER_CAP=$(echo "$LAUNCH" | jq -r .owner_cap_id)
COIN_TYPE=$(echo "$LAUNCH" | jq -r .coin_type)

echo "Launchpad: $LAUNCHPAD"

# Anyone buys.
tai buy --launchpad "$LAUNCHPAD" --coin-type "$COIN_TYPE" --amount-sui 1000000000 --min-out 1

# A "hire" service payment from a second address.
HIRER_COIN=$(sui client gas --json | jq -r '.[0].gasCoinId')
tai pay sui --launchpad "$LAUNCHPAD" --coin-type "$COIN_TYPE" --payment-coin "$HIRER_COIN"

# Inspect.
tai quote --launchpad "$LAUNCHPAD" --coin-type "$COIN_TYPE"
tai account show --launchpad "$LAUNCHPAD" --coin-type "$COIN_TYPE"

# Issue an OperatorCap to a runtime address.
tai op issue \
  --treasury "$TREASURY" \
  --owner-cap "$OWNER_CAP" \
  --recipient 0xc0ffee \
  --daily-limit 10000000000 \
  --allowlist 0xabc,0xdef \
  --ttl-days 30
```

Commit: `examples: CLI quickstart shell script`.

### Task 14.2: TEE-bound agent example (`Tai-Launchpad/examples/tee-agent/`)

A complete reference: a Phala Cloud worker that:
- Generates an Ed25519 key inside the TEE at first boot, sealed to the enclave.
- Exposes the `POST /sign` endpoint with Nautilus attestation.
- A separate `agent-controller` Python script that uses `tai-cli` with `--signer-mode tee` to launch the agent, monitor `ServicePaymentEvent`s, and call `tai op spend-sui` to pay third parties as needed.

Documents the full deployment pipeline: build the worker, deploy to Phala Cloud, register the attestation measurement, then run the controller from anywhere.

Commit: `examples: TEE-bound agent reference (Phala Cloud + Nautilus + tai-cli)`.

### Task 14.3: SDK quickstart (`Tai-Launchpad/examples/sdk-quickstart/`)

A TypeScript script mirroring the CLI quickstart but using `@tai/sdk` directly. Demonstrates that the SDK is a faithful wrapper of the CLI.

Commit: `examples: SDK quickstart (TypeScript)`.

### Task 14.4: Mode docs (`Tai-Launchpad/MODES.md`)

Long-form doc explaining the three modes (sovereign / commissioned / spawned), the cap distributions for each, and example CLI invocations. Cross-link to SPEC §5.12.

Commit: `docs: MODES.md with cap-distribution recipes for sovereign / commissioned / spawned`.

### Task 14.5: CLI reference (`Tai-Launchpad/CLI.md`)

Auto-generated from `clap`'s help output (via a build script in `tai-cli/build.rs` that writes `CLI.md` at compile time), plus hand-written examples for each command.

Commit: `docs: CLI.md reference`.

### Task 14.6: README polish

Update `Tai-Launchpad/README.md`:
- Remove all SAI dependency references.
- Add the agent-native flow as the primary "quickstart" section, with the CLI quickstart inline.
- Demote the web demo to "for human exploration."
- Add the three modes with one-paragraph descriptions each.
- Link out to `MODES.md`, `CLI.md`, `SPEC.md`, `PLAN.md`.

Commit: `docs: README polish (CLI-first, agent-native framing)`.

---

## Self-Review Checklist (run before declaring v1 done)

### Move package

- [ ] **No SAI dependency.** `grep -rE 'sai::' Tai-Launchpad/move/` returns nothing. `Move.toml` lists only `Sui` as a dependency.
- [ ] **No Ika dependency.** `grep -rE 'ika::|dwallet' Tai-Launchpad/move/sources/` returns nothing. The `dwallets_object_id: Option<ID>` field on `LaunchpadAccount` is present and always `option::none` after `launch_agent_coin`.
- [ ] **Spec coverage.** Every section of SPEC §4 (Object Model) and §5 (Mechanism) has an implementing module. Non-goals in §2 are NOT implemented.
- [ ] **No global counters in `LaunchpadConfig`.** Confirm every `buy`, `sell`, `record_service_payment_*` takes `&LaunchpadConfig` (immutable).
- [ ] **All math uses `u128` intermediates.** Audit every `*` in `bonding_curve.move`, `fees.move`, `views.move`. Every `as u64` downcast is preceded by `assert!(x <= MAX_U64, EMathOverflow)`.
- [ ] **Test count.** Every entry function has at least one success test plus one failure test per documented error code. Every view function has at least three tests (zero, target, 2× target).
- [ ] **No placeholders.** `grep -rE 'TODO|TBD|FIXME|XXX' Tai-Launchpad/move/` returns nothing.
- [ ] **No emojis.** `grep -rPn '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' Tai-Launchpad/move/` returns nothing.
- [ ] **TreasuryCap unreachable except for controlled burn.** Only `fees::distribute_token` reaches the cap, via `lp::holder_cap_mut` (`public(package)`).
- [ ] **NAV non-withdrawable.** No public function takes from `LaunchpadAccount.nav_sui` or `nav_token`.
- [ ] **OwnerCap-gated treasury access.** Every `withdraw_*` and `issue_operator_cap` / `revoke_operator_cap` asserts `owner_cap.agent_treasury_id == object::id(treasury)`.
- [ ] **OperatorCap policy enforced at the Move layer.** `operator_spend_sui` checks revocation, TTL, allowlist, and daily limit in that order; daily epoch rollover resets `spent_today_sui`.
- [ ] **Cross-object linkage invariants.** Every cross-call asserts bidirectional linkage.
- [ ] **Self-payment exclusion.** Creator self-payments grow NAV but not `lifetime_service_revenue_sui`.
- [ ] **Token service payment requires opt-in.** `accept_coin_payments == false` aborts.
- [ ] **Slippage mandatory.** Every public buy/sell has `min_out` parameter; aborts with `ESlippageExceeded`.
- [ ] **Fee shares sum to 10000** under all admin updates.
- [ ] **AgentTreasury auto-created at launch.** No separate `create_treasury` entry function in v1.

### Rust / CLI

- [ ] **`tai --version` returns the workspace version.** Builds for all five target triples in CI.
- [ ] **JSON output mode is the default when piped.** `tai launch ... | jq .launchpad_id` works without `--output json`.
- [ ] **Exit codes are documented** in `CLI.md` and match the source.
- [ ] **All four signer modes work end-to-end** on testnet: `ed25519`, `sui-keystore`, `turnkey`, `tee`.
- [ ] **TEE signer verifies the Nautilus attestation report** before accepting a signature.
- [ ] **The CLI quickstart shell script runs end-to-end** on a clean testnet wallet.
- [ ] **The TEE-bound agent example deploys and operates** on Phala Cloud.

### SDK

- [ ] **`@tai/sdk` integration test passes** against testnet.
- [ ] **WASM bundle size is < 2 MB** uncompressed (target for browser usability).

If any item fails, fix it before shipping.

---

## Open questions for the human (NOT for the implementing agent)

These need user input before mainnet deploy. The implementing agent uses v1 defaults.

1. **Platform treasury address.** Currently defaults to publisher's address. Should be a multisig before mainnet.
2. **Cred saturation threshold.** Default 1000 SUI lifetime revenue → 2.0x. May need adjustment for actual SUI price and target hire-fee distribution.
3. **Service-payment fee shares.** Defaults: SUI 40/50/10, token 40/50/10 (NAV / burn / creator). Revisit after first 30 days of mainnet data.
4. **OperatorCap default scope at launch.** Currently `daily_limit_sui = 10 SUI`, `allowed_targets = []`, `expires_at_ms = launched_at + 90 days`. Empty allowlist means the cap can't spend SUI until the OwnerCap holder updates it — restrictive default. Acceptable?
5. **Sponsored-gas budget per agent.** Proposing $5 in cumulative sponsorship per agent across launch txs and first ~50 service-payment calls. Beyond that, agent treasury pays. Cap acceptable?
6. **`set_creator` v1 or v1.5?** Now resolved: OwnerCap is `key + store`. "Set creator" is just `public_transfer` of the OwnerCap. No custom function needed in v1.
7. **Agent NFT custody.** v1 uses dynamic fields on `AgentTreasury` for arbitrary-coin storage. Generic `claim_received_coin<X, T>` for arbitrary `Coin<X>` is v1.1. Kiosk integration is v1.5.
8. **One-transaction launch via on-client bytecode templating.** v1.5 stretch. Pump.fun does this on Solana via a Rust binary; we'd compile the templater to WASM and run it in the browser / inline in `tai-cli`.

---

## Execution choice

This plan is ready to execute. Two options:

1. **Subagent-driven (recommended).** Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline execution.** Execute tasks in this session using `executing-plans`, batch with checkpoints.

A fresh agent picking up this folder should choose option 1 by default.
