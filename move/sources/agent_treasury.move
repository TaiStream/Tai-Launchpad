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
    use sui::event;
    use sui::sui::SUI;

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
    public struct OperatorCap<phantom T> has key, store {
        id: UID,
        agent_treasury_id: ID,
        daily_limit_sui: u64,
        spent_today_sui: u64,
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
}
