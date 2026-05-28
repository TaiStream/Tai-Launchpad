/// Module: agent_treasury
///
/// Object-bound custody for an agent's working capital. Separate from
/// `LaunchpadAccount.nav_*` (the productive treasury, non-withdrawable).
///
/// `AgentTreasury<T>` holds `Coin<SUI>` and `Coin<T>` balances. Withdrawals
/// gated by transferable `OwnerCap<T>`. Day-to-day spending gated by scoped
/// `OperatorCap<T>` (daily limit, allowlist, TTL, revocation — all enforced
/// in Move).
///
/// Mode is an emergent property of cap distribution:
///   - sovereign:    owner_cap_recipient == operator_recipient (agent owns itself)
///   - commissioned: owner_cap_recipient is human, operator_recipient is agent
///   - spawned:      owner_cap_recipient is parent's OwnerCap holder
///
/// See SPEC §4.4–4.6, §5.10–5.12 for the authoritative design.
module tai::agent_treasury {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;
    use sui::transfer::Receiving;

    // ============================= Error codes =============================
    const ENotOwnerCap: u64 = 101;
    const ENotOperatorCap: u64 = 102;
    const EOperatorCapRevoked: u64 = 103;
    const EOperatorCapExpired: u64 = 108;
    const EOperatorTargetNotAllowed: u64 = 109;
    const EOperatorDailyLimitExceeded: u64 = 115;
    const EOperatorTtlTooLong: u64 = 116;
    const EOperatorTargetsTooMany: u64 = 117;
    const EOperatorCapNotActive: u64 = 118;
    const EOperatorTokenDailyLimitExceeded: u64 = 119;
    const EInsufficientLiquidity: u64 = 120;

    /// Maximum allowed TTL on an OperatorCap (1 year in milliseconds). Bounds
    /// `now + operator_ttl_ms` arithmetic and forces explicit rotation cadence.
    const MAX_OPERATOR_TTL_MS: u64 = 31_536_000_000;

    /// Maximum allowed_targets length on an OperatorCap. Bounds the cost of
    /// `contains` lookups on every spend. Sixty-four targets is generous —
    /// a real agent rotates fewer counterparties through any given cap.
    const MAX_ALLOWED_TARGETS: u64 = 64;

    public fun e_not_owner_cap(): u64 { ENotOwnerCap }
    public fun e_not_operator_cap(): u64 { ENotOperatorCap }
    public fun e_operator_cap_revoked(): u64 { EOperatorCapRevoked }
    public fun e_operator_cap_expired(): u64 { EOperatorCapExpired }
    public fun e_operator_target_not_allowed(): u64 { EOperatorTargetNotAllowed }
    public fun e_operator_daily_limit_exceeded(): u64 { EOperatorDailyLimitExceeded }
    public fun e_operator_token_daily_limit_exceeded(): u64 { EOperatorTokenDailyLimitExceeded }
    public fun e_operator_ttl_too_long(): u64 { EOperatorTtlTooLong }
    public fun e_operator_targets_too_many(): u64 { EOperatorTargetsTooMany }
    public fun e_operator_cap_not_active(): u64 { EOperatorCapNotActive }
    public fun e_insufficient_liquidity(): u64 { EInsufficientLiquidity }
    public fun max_operator_ttl_ms(): u64 { MAX_OPERATOR_TTL_MS }
    public fun max_allowed_targets(): u64 { MAX_ALLOWED_TARGETS }

    // ============================= Capabilities ============================

    /// Sovereign capability over an agent's treasury. Transferable; standard
    /// `sui::transfer::public_transfer` moves it. Transferring the OwnerCap
    /// effectively transfers ownership of the agent's bank account.
    public struct OwnerCap<phantom T> has key, store {
        id: UID,
        agent_treasury_id: ID,
    }

    /// Daily-ops capability with on-chain policy. Held by the agent's runtime
    /// (or a delegate). Spend limit + allowlist + TTL enforced by Move at
    /// every call to `operator_spend_sui` / `operator_spend_token`.
    ///
    /// Token spend has its own daily budget — denominated in the agent's
    /// own coin base units. A cap with `daily_limit_token == 0` cannot
    /// spend any token, only SUI.
    public struct OperatorCap<phantom T> has key, store {
        id: UID,
        agent_treasury_id: ID,
        daily_limit_sui: u64,
        spent_today_sui: u64,
        daily_limit_token: u64,
        spent_today_token: u64,
        epoch_day: u64,                  // floor(clock_ms / 86_400_000)
        allowed_targets: vector<address>,
        expires_at_ms: u64,              // 0 = no expiry
    }

    // ============================= Treasury ================================

    /// The agent's operational treasury. Shared object. Linked to its
    /// `LaunchpadAccount<T>` via `launchpad_account_id`.
    public struct AgentTreasury<phantom T> has key {
        id: UID,
        launchpad_account_id: ID,
        owner_cap_id: ID,
        active_operator_cap_ids: vector<ID>,

        sui_balance: Balance<SUI>,
        token_balance: Balance<T>,
    }

    // ============================= Events ==================================

    public struct OperatorCapIssuedEvent has copy, drop {
        agent_treasury_id: ID,
        operator_cap_id: ID,
        recipient: address,
        daily_limit_sui: u64,
        allowed_targets: vector<address>,
        expires_at_ms: u64,
    }

    #[allow(unused_field)]
    public struct OperatorCapRevokedEvent has copy, drop {
        agent_treasury_id: ID,
        operator_cap_id: ID,
    }

    #[allow(unused_field)]
    public struct TreasuryWithdrawEvent has copy, drop {
        agent_treasury_id: ID,
        coin_type: u8,                   // 0 = SUI, 1 = T
        amount: u64,
        to: address,
        via: u8,                         // 0 = OwnerCap, 1 = OperatorCap
    }

    // ============================= Getters =================================

    public fun treasury_launchpad_account_id<T>(t: &AgentTreasury<T>): ID { t.launchpad_account_id }
    public fun treasury_owner_cap_id<T>(t: &AgentTreasury<T>): ID { t.owner_cap_id }
    public fun treasury_sui_balance<T>(t: &AgentTreasury<T>): u64 { balance::value(&t.sui_balance) }
    public fun treasury_token_balance<T>(t: &AgentTreasury<T>): u64 { balance::value(&t.token_balance) }
    public fun treasury_active_operator_cap_count<T>(t: &AgentTreasury<T>): u64 {
        t.active_operator_cap_ids.length()
    }
    public fun treasury_has_operator_cap<T>(t: &AgentTreasury<T>, cap_id: ID): bool {
        t.active_operator_cap_ids.contains(&cap_id)
    }

    public fun owner_cap_agent_treasury_id<T>(c: &OwnerCap<T>): ID { c.agent_treasury_id }

    public fun operator_cap_agent_treasury_id<T>(c: &OperatorCap<T>): ID { c.agent_treasury_id }
    public fun operator_cap_daily_limit<T>(c: &OperatorCap<T>): u64 { c.daily_limit_sui }
    public fun operator_cap_spent_today<T>(c: &OperatorCap<T>): u64 { c.spent_today_sui }
    public fun operator_cap_daily_limit_token<T>(c: &OperatorCap<T>): u64 { c.daily_limit_token }
    public fun operator_cap_spent_today_token<T>(c: &OperatorCap<T>): u64 { c.spent_today_token }
    public fun operator_cap_epoch_day<T>(c: &OperatorCap<T>): u64 { c.epoch_day }
    public fun operator_cap_allowed_targets<T>(c: &OperatorCap<T>): vector<address> {
        c.allowed_targets
    }
    public fun operator_cap_expires_at_ms<T>(c: &OperatorCap<T>): u64 { c.expires_at_ms }

    // ============================= Internal constructor ====================

    /// Called by `tai::launchpad::launch_agent_coin` to atomically create the
    /// treasury, mint the OwnerCap to `owner_cap_recipient`, and optionally
    /// mint an OperatorCap to `operator_recipient` with the provided scope.
    ///
    /// Returns `(treasury_id, owner_cap_id)` so the caller can stamp them
    /// into the LaunchpadAccount's linkage fields.
    ///
    /// `public(package)` only — never callable from outside the `tai` package.
    public(package) fun build_treasury_owner_and_optional_operator<T>(
        launchpad_account_id: ID,
        owner_cap_recipient: address,
        operator_recipient: Option<address>,
        operator_daily_limit_sui: u64,
        operator_daily_limit_token: u64,
        operator_allowed_targets: vector<address>,
        operator_ttl_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ): (ID, ID) {
        let treasury_uid = object::new(ctx);
        let treasury_id = treasury_uid.to_inner();
        let owner_cap_uid = object::new(ctx);
        let owner_cap_id = owner_cap_uid.to_inner();

        let owner_cap = OwnerCap<T> {
            id: owner_cap_uid,
            agent_treasury_id: treasury_id,
        };

        let mut treasury = AgentTreasury<T> {
            id: treasury_uid,
            launchpad_account_id,
            owner_cap_id,
            active_operator_cap_ids: vector[],
            sui_balance: balance::zero<SUI>(),
            token_balance: balance::zero<T>(),
        };

        if (operator_recipient.is_some()) {
            assert!(operator_ttl_ms <= MAX_OPERATOR_TTL_MS, EOperatorTtlTooLong);
            assert!(
                operator_allowed_targets.length() <= MAX_ALLOWED_TARGETS,
                EOperatorTargetsTooMany,
            );
            let recipient = *operator_recipient.borrow();
            let op_cap_uid = object::new(ctx);
            let op_cap_id = op_cap_uid.to_inner();
            let now = clock::timestamp_ms(clock);
            let expires_at = if (operator_ttl_ms == 0) 0 else now + operator_ttl_ms;
            let op_cap = OperatorCap<T> {
                id: op_cap_uid,
                agent_treasury_id: treasury_id,
                daily_limit_sui: operator_daily_limit_sui,
                spent_today_sui: 0,
                daily_limit_token: operator_daily_limit_token,
                spent_today_token: 0,
                epoch_day: now / 86_400_000,
                allowed_targets: operator_allowed_targets,
                expires_at_ms: expires_at,
            };
            treasury.active_operator_cap_ids.push_back(op_cap_id);

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

    // ============================= OwnerCap-gated withdrawals ==============

    #[allow(lint(self_transfer))]
    public fun withdraw_sui<T>(
        treasury: &mut AgentTreasury<T>,
        owner_cap: &OwnerCap<T>,
        amount: u64,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert!(owner_cap.agent_treasury_id == object::id(treasury), ENotOwnerCap);
        assert!(balance::value(&treasury.sui_balance) >= amount, EInsufficientLiquidity);
        let payout = balance::split(&mut treasury.sui_balance, amount);
        transfer::public_transfer(coin::from_balance(payout, ctx), to);
        event::emit(TreasuryWithdrawEvent {
            agent_treasury_id: object::id(treasury),
            coin_type: 0,
            amount,
            to,
            via: 0,
        });
    }

    #[allow(lint(self_transfer))]
    public fun withdraw_token<T>(
        treasury: &mut AgentTreasury<T>,
        owner_cap: &OwnerCap<T>,
        amount: u64,
        to: address,
        ctx: &mut TxContext,
    ) {
        assert!(owner_cap.agent_treasury_id == object::id(treasury), ENotOwnerCap);
        assert!(balance::value(&treasury.token_balance) >= amount, EInsufficientLiquidity);
        let payout = balance::split(&mut treasury.token_balance, amount);
        transfer::public_transfer(coin::from_balance(payout, ctx), to);
        event::emit(TreasuryWithdrawEvent {
            agent_treasury_id: object::id(treasury),
            coin_type: 1,
            amount,
            to,
            via: 0,
        });
    }

    // ============================= Permissionless top-ups ==================

    /// Anyone can fund the treasury directly via SUI.
    public fun top_up_sui<T>(treasury: &mut AgentTreasury<T>, payment: Coin<SUI>) {
        balance::join(&mut treasury.sui_balance, coin::into_balance(payment));
    }

    /// Anyone can fund the treasury with the agent's own token.
    public fun top_up_token<T>(treasury: &mut AgentTreasury<T>, payment: Coin<T>) {
        balance::join(&mut treasury.token_balance, coin::into_balance(payment));
    }

    // ============================= Transfer-to-object claim ================

    /// Claim a SUI coin sent via `transfer::public_transfer(coin, treasury_addr)`.
    /// Joins the received balance into `treasury.sui_balance`.
    public fun claim_received_sui<T>(
        treasury: &mut AgentTreasury<T>,
        receiving: Receiving<Coin<SUI>>,
    ) {
        let received = transfer::public_receive(&mut treasury.id, receiving);
        balance::join(&mut treasury.sui_balance, coin::into_balance(received));
    }

    /// Claim a Coin<T> sent via transfer-to-object.
    public fun claim_received_token<T>(
        treasury: &mut AgentTreasury<T>,
        receiving: Receiving<Coin<T>>,
    ) {
        let received = transfer::public_receive(&mut treasury.id, receiving);
        balance::join(&mut treasury.token_balance, coin::into_balance(received));
    }

    // ============================= OperatorCap lifecycle ===================

    /// Post-launch OperatorCap issuance. OwnerCap-gated.
    public fun issue_operator_cap<T>(
        treasury: &mut AgentTreasury<T>,
        owner_cap: &OwnerCap<T>,
        recipient: address,
        daily_limit_sui: u64,
        daily_limit_token: u64,
        allowed_targets: vector<address>,
        ttl_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(owner_cap.agent_treasury_id == object::id(treasury), ENotOwnerCap);
        assert!(ttl_ms <= MAX_OPERATOR_TTL_MS, EOperatorTtlTooLong);
        assert!(
            allowed_targets.length() <= MAX_ALLOWED_TARGETS,
            EOperatorTargetsTooMany,
        );
        let now = clock::timestamp_ms(clock);
        let expires_at = if (ttl_ms == 0) 0 else now + ttl_ms;
        let op_cap_uid = object::new(ctx);
        let op_cap_id = op_cap_uid.to_inner();
        let op_cap = OperatorCap<T> {
            id: op_cap_uid,
            agent_treasury_id: object::id(treasury),
            daily_limit_sui,
            spent_today_sui: 0,
            daily_limit_token,
            spent_today_token: 0,
            epoch_day: now / 86_400_000,
            allowed_targets,
            expires_at_ms: expires_at,
        };
        treasury.active_operator_cap_ids.push_back(op_cap_id);
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

    /// OwnerCap-gated mutator for an existing OperatorCap's allowed_targets
    /// vector. Lets the owner add/remove targets without revoking + reissuing.
    /// The OperatorCap object must be passed by &mut so the holder still
    /// owns it after this returns. Cap must be in the active set.
    public fun update_operator_cap_targets<T>(
        treasury: &mut AgentTreasury<T>,
        owner_cap: &OwnerCap<T>,
        op_cap: &mut OperatorCap<T>,
        new_targets: vector<address>,
    ) {
        assert!(owner_cap.agent_treasury_id == object::id(treasury), ENotOwnerCap);
        assert!(op_cap.agent_treasury_id == object::id(treasury), ENotOperatorCap);
        assert!(
            treasury.active_operator_cap_ids.contains(&object::id(op_cap)),
            EOperatorCapNotActive,
        );
        assert!(
            new_targets.length() <= MAX_ALLOWED_TARGETS,
            EOperatorTargetsTooMany,
        );
        op_cap.allowed_targets = new_targets;
    }

    /// Remove an OperatorCap from the active set. The cap object itself
    /// stays in its holder's inventory but presenting it via spend functions
    /// will fail (EOperatorCapRevoked).
    public fun revoke_operator_cap<T>(
        treasury: &mut AgentTreasury<T>,
        owner_cap: &OwnerCap<T>,
        cap_id: ID,
    ) {
        assert!(owner_cap.agent_treasury_id == object::id(treasury), ENotOwnerCap);
        let (found, idx) = treasury.active_operator_cap_ids.index_of(&cap_id);
        assert!(found, EOperatorCapNotActive);
        treasury.active_operator_cap_ids.remove(idx);
        event::emit(OperatorCapRevokedEvent {
            agent_treasury_id: object::id(treasury),
            operator_cap_id: cap_id,
        });
    }

    // ============================= OperatorCap-gated spend =================

    /// Spend SUI from the treasury under the OperatorCap's policy.
    /// All gates enforced in Move:
    ///   1. cap's agent_treasury_id matches.
    ///   2. cap is in the treasury's active_operator_cap_ids set.
    ///   3. clock < expires_at_ms (if non-zero).
    ///   4. `to` is in the cap's allowed_targets.
    ///   5. spent_today_sui + amount <= daily_limit_sui (with daily epoch reset).
    ///   6. treasury has enough SUI.
    #[allow(lint(self_transfer))]
    public fun operator_spend_sui<T>(
        treasury: &mut AgentTreasury<T>,
        op_cap: &mut OperatorCap<T>,
        amount: u64,
        to: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // 1.
        assert!(op_cap.agent_treasury_id == object::id(treasury), ENotOperatorCap);
        // 2.
        assert!(
            treasury.active_operator_cap_ids.contains(&object::id(op_cap)),
            EOperatorCapRevoked,
        );
        // 3.
        let now = clock::timestamp_ms(clock);
        if (op_cap.expires_at_ms != 0) {
            assert!(now < op_cap.expires_at_ms, EOperatorCapExpired);
        };
        // 4.
        assert!(op_cap.allowed_targets.contains(&to), EOperatorTargetNotAllowed);
        // 5. Daily epoch rollover before checking the limit. Both SUI and
        //    token budgets reset together on the same day boundary.
        let current_day = now / 86_400_000;
        if (current_day > op_cap.epoch_day) {
            op_cap.epoch_day = current_day;
            op_cap.spent_today_sui = 0;
            op_cap.spent_today_token = 0;
        };
        assert!(
            op_cap.spent_today_sui + amount <= op_cap.daily_limit_sui,
            EOperatorDailyLimitExceeded,
        );
        op_cap.spent_today_sui = op_cap.spent_today_sui + amount;
        // 6.
        assert!(balance::value(&treasury.sui_balance) >= amount, EInsufficientLiquidity);
        let payout = balance::split(&mut treasury.sui_balance, amount);
        transfer::public_transfer(coin::from_balance(payout, ctx), to);
        event::emit(TreasuryWithdrawEvent {
            agent_treasury_id: object::id(treasury),
            coin_type: 0,
            amount,
            to,
            via: 1,
        });
    }

    /// Token-denominated mirror of `operator_spend_sui`. Spends the agent's
    /// own `T` token under the same per-cap policy. Daily limit is denominated
    /// in T base units via `daily_limit_token`.
    #[allow(lint(self_transfer))]
    public fun operator_spend_token<T>(
        treasury: &mut AgentTreasury<T>,
        op_cap: &mut OperatorCap<T>,
        amount: u64,
        to: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(op_cap.agent_treasury_id == object::id(treasury), ENotOperatorCap);
        assert!(
            treasury.active_operator_cap_ids.contains(&object::id(op_cap)),
            EOperatorCapRevoked,
        );
        let now = clock::timestamp_ms(clock);
        if (op_cap.expires_at_ms != 0) {
            assert!(now < op_cap.expires_at_ms, EOperatorCapExpired);
        };
        assert!(op_cap.allowed_targets.contains(&to), EOperatorTargetNotAllowed);
        let current_day = now / 86_400_000;
        if (current_day > op_cap.epoch_day) {
            op_cap.epoch_day = current_day;
            op_cap.spent_today_sui = 0;
            op_cap.spent_today_token = 0;
        };
        assert!(
            op_cap.spent_today_token + amount <= op_cap.daily_limit_token,
            EOperatorTokenDailyLimitExceeded,
        );
        op_cap.spent_today_token = op_cap.spent_today_token + amount;
        assert!(balance::value(&treasury.token_balance) >= amount, EInsufficientLiquidity);
        let payout = balance::split(&mut treasury.token_balance, amount);
        transfer::public_transfer(coin::from_balance(payout, ctx), to);
        event::emit(TreasuryWithdrawEvent {
            agent_treasury_id: object::id(treasury),
            coin_type: 1,
            amount,
            to,
            via: 1,
        });
    }

    // ============================= Test helpers ============================

    /// Test-only constructor for an OwnerCap with an arbitrary
    /// agent_treasury_id. Exercises the ENotOwnerCap assertion in
    /// withdraw_*, issue_operator_cap, revoke_operator_cap. Otherwise
    /// structurally unreachable because OwnerCap construction is
    /// public(package) and only via the launch path.
    #[test_only]
    public fun test_only_make_owner_cap<T>(
        agent_treasury_id: ID,
        ctx: &mut TxContext,
    ): OwnerCap<T> {
        OwnerCap<T> { id: object::new(ctx), agent_treasury_id }
    }
}
