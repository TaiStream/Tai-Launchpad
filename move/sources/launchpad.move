/// Module: launchpad
/// Sui-native agent creator-coin launchpad with NAV accumulation from BOTH
/// trading and on-chain service revenue, performance-linked hire pricing,
/// optional token-gated access, and optional coin-denominated hire payments.
/// The launchpad is the pool — trades settle against the launchpad's own
/// balances using bonding-curve math.
///
/// See ../../SPEC.md for the authoritative design document.
module tai::launchpad {
    use sui::balance::{Self, Balance};
    use sui::coin::{TreasuryCap};
    use sui::sui::SUI;
    use std::string::String;

    // ============================= Error Codes =============================
    // Caller / authorization
    const ENotCreator: u64 = 100;
    // Cross-object linkage
    const ETreasuryCapNotEmpty: u64 = 104;
    const ELaunchpadMismatch: u64 = 105;
    const ECoinPaymentsDisabled: u64 = 107;
    // Fee / share invariants
    const EFeeBpsInvalid: u64 = 110;
    const EFeeBpsZero: u64 = 111;
    const ECredTargetZero: u64 = 113;
    // Trading
    const EInsufficientLiquidity: u64 = 120;
    const ESlippageExceeded: u64 = 121;
    const EMathOverflow: u64 = 122;
    // Admin
    const ENotAdmin: u64 = 140;

    // ============================= Constants ===============================
    // Trade fee defaults
    const DEFAULT_TRADE_FEE_BPS: u64 = 100;
    const DEFAULT_TRADE_NAV_BPS: u64 = 3000;
    const DEFAULT_TRADE_CREATOR_BPS: u64 = 6000;
    const DEFAULT_TRADE_PLATFORM_BPS: u64 = 1000;

    // Service-SUI fee defaults
    const DEFAULT_SERVICE_NAV_BPS: u64 = 4000;
    const DEFAULT_SERVICE_CREATOR_BPS: u64 = 5000;
    const DEFAULT_SERVICE_PLATFORM_BPS: u64 = 1000;

    // Service-token fee defaults
    const DEFAULT_TOKEN_SERVICE_NAV_BPS: u64 = 4000;
    const DEFAULT_TOKEN_SERVICE_BURN_BPS: u64 = 5000;
    const DEFAULT_TOKEN_SERVICE_CREATOR_BPS: u64 = 1000;

    // Bonding curve defaults
    const DEFAULT_VIRTUAL_SUI_RESERVES: u64 = 10_000_000_000_000;            // 10k SUI in MIST
    const DEFAULT_VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000_000_000_000;   // 1.073B with 9 decimals
    const DEFAULT_SALE_SUPPLY: u64 = 800_000_000_000_000_000;
    const DEFAULT_LP_SUPPLY: u64 = 200_000_000_000_000_000;

    // Cred multiplier saturation: 1000 SUI lifetime service revenue -> 2.0x.
    const DEFAULT_CRED_REVENUE_TARGET: u64 = 1_000_000_000_000;              // 1000 SUI in MIST

    const BPS_DENOMINATOR: u64 = 10_000;

    // ============================= Structs =================================
    public struct LaunchpadConfig has key {
        id: UID,
        admin: address,
        platform_treasury: address,

        // Trade fee shares
        trade_fee_bps: u64,
        trade_nav_share_bps: u64,
        trade_creator_share_bps: u64,
        trade_platform_share_bps: u64,

        // Service-SUI fee shares
        service_nav_share_bps: u64,
        service_creator_share_bps: u64,
        service_platform_share_bps: u64,

        // Service-token fee shares
        token_service_nav_share_bps: u64,
        token_service_burn_share_bps: u64,
        token_service_creator_share_bps: u64,

        // Curve constants
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        sale_supply: u64,
        lp_supply: u64,

        // Cred saturation target (lifetime service revenue in MIST)
        cred_revenue_target: u64,
    }

    // ============================= Init ====================================
    fun init(ctx: &mut TxContext) {
        let sender = ctx.sender();
        let config = LaunchpadConfig {
            id: object::new(ctx),
            admin: sender,
            platform_treasury: sender,
            trade_fee_bps: DEFAULT_TRADE_FEE_BPS,
            trade_nav_share_bps: DEFAULT_TRADE_NAV_BPS,
            trade_creator_share_bps: DEFAULT_TRADE_CREATOR_BPS,
            trade_platform_share_bps: DEFAULT_TRADE_PLATFORM_BPS,
            service_nav_share_bps: DEFAULT_SERVICE_NAV_BPS,
            service_creator_share_bps: DEFAULT_SERVICE_CREATOR_BPS,
            service_platform_share_bps: DEFAULT_SERVICE_PLATFORM_BPS,
            token_service_nav_share_bps: DEFAULT_TOKEN_SERVICE_NAV_BPS,
            token_service_burn_share_bps: DEFAULT_TOKEN_SERVICE_BURN_BPS,
            token_service_creator_share_bps: DEFAULT_TOKEN_SERVICE_CREATOR_BPS,
            virtual_sui_reserves: DEFAULT_VIRTUAL_SUI_RESERVES,
            virtual_token_reserves: DEFAULT_VIRTUAL_TOKEN_RESERVES,
            sale_supply: DEFAULT_SALE_SUPPLY,
            lp_supply: DEFAULT_LP_SUPPLY,
            cred_revenue_target: DEFAULT_CRED_REVENUE_TARGET,
        };
        transfer::share_object(config);
    }

    // ============================= Getters =================================
    public fun config_admin(c: &LaunchpadConfig): address { c.admin }
    public fun config_platform_treasury(c: &LaunchpadConfig): address { c.platform_treasury }

    public fun config_trade_fee_bps(c: &LaunchpadConfig): u64 { c.trade_fee_bps }
    public fun config_trade_nav_share_bps(c: &LaunchpadConfig): u64 { c.trade_nav_share_bps }
    public fun config_trade_creator_share_bps(c: &LaunchpadConfig): u64 { c.trade_creator_share_bps }
    public fun config_trade_platform_share_bps(c: &LaunchpadConfig): u64 { c.trade_platform_share_bps }

    public fun config_service_nav_share_bps(c: &LaunchpadConfig): u64 { c.service_nav_share_bps }
    public fun config_service_creator_share_bps(c: &LaunchpadConfig): u64 { c.service_creator_share_bps }
    public fun config_service_platform_share_bps(c: &LaunchpadConfig): u64 { c.service_platform_share_bps }

    public fun config_token_service_nav_share_bps(c: &LaunchpadConfig): u64 { c.token_service_nav_share_bps }
    public fun config_token_service_burn_share_bps(c: &LaunchpadConfig): u64 { c.token_service_burn_share_bps }
    public fun config_token_service_creator_share_bps(c: &LaunchpadConfig): u64 { c.token_service_creator_share_bps }

    public fun config_virtual_sui_reserves(c: &LaunchpadConfig): u64 { c.virtual_sui_reserves }
    public fun config_virtual_token_reserves(c: &LaunchpadConfig): u64 { c.virtual_token_reserves }
    public fun config_sale_supply(c: &LaunchpadConfig): u64 { c.sale_supply }
    public fun config_lp_supply(c: &LaunchpadConfig): u64 { c.lp_supply }

    public fun config_cred_revenue_target(c: &LaunchpadConfig): u64 { c.cred_revenue_target }

    public fun bps_denominator(): u64 { BPS_DENOMINATOR }

    // Error code accessors
    public fun e_not_creator(): u64 { ENotCreator }
    public fun e_treasury_cap_not_empty(): u64 { ETreasuryCapNotEmpty }
    public fun e_launchpad_mismatch(): u64 { ELaunchpadMismatch }
    public fun e_coin_payments_disabled(): u64 { ECoinPaymentsDisabled }
    public fun e_fee_bps_invalid(): u64 { EFeeBpsInvalid }
    public fun e_fee_bps_zero(): u64 { EFeeBpsZero }
    public fun e_cred_target_zero(): u64 { ECredTargetZero }
    public fun e_insufficient_liquidity(): u64 { EInsufficientLiquidity }
    public fun e_slippage_exceeded(): u64 { ESlippageExceeded }
    public fun e_math_overflow(): u64 { EMathOverflow }
    public fun e_not_admin(): u64 { ENotAdmin }

    // ============================= Admin entry functions ===================
    public fun set_platform_treasury(
        config: &mut LaunchpadConfig,
        new_treasury: address,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        config.platform_treasury = new_treasury;
    }

    public fun set_trade_shares(
        config: &mut LaunchpadConfig,
        nav_bps: u64,
        creator_bps: u64,
        platform_bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        assert!(nav_bps + creator_bps + platform_bps == BPS_DENOMINATOR, EFeeBpsInvalid);
        config.trade_nav_share_bps = nav_bps;
        config.trade_creator_share_bps = creator_bps;
        config.trade_platform_share_bps = platform_bps;
    }

    public fun set_service_shares(
        config: &mut LaunchpadConfig,
        nav_bps: u64,
        creator_bps: u64,
        platform_bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        assert!(nav_bps + creator_bps + platform_bps == BPS_DENOMINATOR, EFeeBpsInvalid);
        config.service_nav_share_bps = nav_bps;
        config.service_creator_share_bps = creator_bps;
        config.service_platform_share_bps = platform_bps;
    }

    public fun set_token_service_shares(
        config: &mut LaunchpadConfig,
        nav_bps: u64,
        burn_bps: u64,
        creator_bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        assert!(nav_bps + burn_bps + creator_bps == BPS_DENOMINATOR, EFeeBpsInvalid);
        config.token_service_nav_share_bps = nav_bps;
        config.token_service_burn_share_bps = burn_bps;
        config.token_service_creator_share_bps = creator_bps;
    }

    public fun set_trade_fee_bps(
        config: &mut LaunchpadConfig,
        bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        assert!(bps > 0, EFeeBpsZero);
        config.trade_fee_bps = bps;
    }

    public fun set_cred_revenue_target(
        config: &mut LaunchpadConfig,
        target: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        assert!(target > 0, ECredTargetZero);
        config.cred_revenue_target = target;
    }

    public fun transfer_admin(
        config: &mut LaunchpadConfig,
        new_admin: address,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == config.admin, ENotAdmin);
        config.admin = new_admin;
    }

    // ============================= LaunchpadAccount<T> =====================
    /// The per-agent launchpad object. THIS OBJECT IS THE POOL — trades
    /// settle against real_sui_balance and real_token_balance using
    /// bonding-curve math with snapshotted virtual reserves.
    ///
    /// Linked to sibling objects via:
    ///   - treasury_cap_holder_id   <-> TreasuryCapHolder<T>
    ///   - agent_treasury_id        <-> AgentTreasury<T>     (tai::agent_treasury)
    ///   - owner_cap_id             <-> OwnerCap<T>          (tai::agent_treasury)
    ///   - dwallets_object_id       <-> RESERVED for v1.1 Ika adapter
    public struct LaunchpadAccount<phantom T> has key {
        id: UID,

        // Ownership + identity
        creator: address,
        linked_identity: Option<ID>,
        coin_type_name: String,
        total_supply: u64,
        decimals: u8,

        // Bonding curve state (these balances ARE the pool)
        real_sui_balance: Balance<SUI>,
        real_token_balance: Balance<T>,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,

        // LP reserve (locked permanently in v1)
        lp_reserve: Balance<T>,

        // NAV — grows from BOTH trade fees AND service payments
        nav_sui: Balance<SUI>,
        nav_token: Balance<T>,

        // Productive-asset layer
        access_threshold: u64,
        accept_coin_payments: bool,
        lifetime_service_revenue_sui: u64,
        cred_revenue_target: u64,

        // Sibling-object linkage
        treasury_cap_holder_id: ID,
        agent_treasury_id: ID,
        owner_cap_id: ID,
        dwallets_object_id: Option<ID>,   // RESERVED for v1.1 Ika adapter

        // Cumulative stats (per-account)
        total_buys: u64,
        total_sells: u64,
        total_service_payments_sui: u64,
        total_service_payments_token: u64,
        cumulative_volume_sui: u64,
        cumulative_fees_sui: u64,
        launched_at: u64,
    }

    /// Wraps TreasuryCap<T> after launch. Used only by tai::fees::distribute_token
    /// to burn token-denominated service-payment shares. No public accessor
    /// returns the cap.
    public struct TreasuryCapHolder<phantom T> has key {
        id: UID,
        cap: TreasuryCap<T>,
        launchpad_account_id: ID,
    }

    // ============================= Events ==================================
    #[allow(unused_field)]
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

    // ============================= Account getters =========================
    public fun account_creator<T>(a: &LaunchpadAccount<T>): address { a.creator }
    public fun account_linked_identity<T>(a: &LaunchpadAccount<T>): Option<ID> { a.linked_identity }
    public fun account_coin_type_name<T>(a: &LaunchpadAccount<T>): String { a.coin_type_name }
    public fun account_total_supply<T>(a: &LaunchpadAccount<T>): u64 { a.total_supply }
    public fun account_decimals<T>(a: &LaunchpadAccount<T>): u8 { a.decimals }

    public fun account_real_sui<T>(a: &LaunchpadAccount<T>): u64 { balance::value(&a.real_sui_balance) }
    public fun account_real_token<T>(a: &LaunchpadAccount<T>): u64 { balance::value(&a.real_token_balance) }
    public fun account_virtual_sui<T>(a: &LaunchpadAccount<T>): u64 { a.virtual_sui_reserves }
    public fun account_virtual_token<T>(a: &LaunchpadAccount<T>): u64 { a.virtual_token_reserves }
    public fun account_lp_reserve<T>(a: &LaunchpadAccount<T>): u64 { balance::value(&a.lp_reserve) }

    public fun account_nav_sui<T>(a: &LaunchpadAccount<T>): u64 { balance::value(&a.nav_sui) }
    public fun account_nav_token<T>(a: &LaunchpadAccount<T>): u64 { balance::value(&a.nav_token) }

    public fun account_access_threshold<T>(a: &LaunchpadAccount<T>): u64 { a.access_threshold }
    public fun account_accept_coin_payments<T>(a: &LaunchpadAccount<T>): bool { a.accept_coin_payments }
    public fun account_lifetime_service_revenue<T>(a: &LaunchpadAccount<T>): u64 { a.lifetime_service_revenue_sui }
    public fun account_cred_revenue_target<T>(a: &LaunchpadAccount<T>): u64 { a.cred_revenue_target }

    public fun account_treasury_cap_holder_id<T>(a: &LaunchpadAccount<T>): ID { a.treasury_cap_holder_id }
    public fun account_agent_treasury_id<T>(a: &LaunchpadAccount<T>): ID { a.agent_treasury_id }
    public fun account_owner_cap_id<T>(a: &LaunchpadAccount<T>): ID { a.owner_cap_id }
    public fun account_dwallets_object_id<T>(a: &LaunchpadAccount<T>): Option<ID> { a.dwallets_object_id }

    public fun account_total_buys<T>(a: &LaunchpadAccount<T>): u64 { a.total_buys }
    public fun account_total_sells<T>(a: &LaunchpadAccount<T>): u64 { a.total_sells }
    public fun account_total_service_payments_sui<T>(a: &LaunchpadAccount<T>): u64 { a.total_service_payments_sui }
    public fun account_total_service_payments_token<T>(a: &LaunchpadAccount<T>): u64 { a.total_service_payments_token }
    public fun account_cumulative_volume<T>(a: &LaunchpadAccount<T>): u64 { a.cumulative_volume_sui }
    public fun account_cumulative_fees<T>(a: &LaunchpadAccount<T>): u64 { a.cumulative_fees_sui }
    public fun account_launched_at<T>(a: &LaunchpadAccount<T>): u64 { a.launched_at }

    // ============================= TreasuryCapHolder accessors =============
    public fun holder_launchpad_account_id<T>(h: &TreasuryCapHolder<T>): ID {
        h.launchpad_account_id
    }

    /// Package-only accessor for the wrapped TreasuryCap. The ONLY post-launch
    /// use of this cap is `coin::burn` from inside `tai::fees::distribute_token`
    /// during a token-denominated service payment. No public function exposes
    /// the cap externally.
    public(package) fun holder_cap_mut<T>(h: &mut TreasuryCapHolder<T>): &mut TreasuryCap<T> {
        &mut h.cap
    }

    // ============================= Test helpers ============================
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
