/// Module: launchpad
/// Sui-native agent creator-coin launchpad with NAV accumulation from BOTH
/// trading and on-chain service revenue, performance-linked hire pricing,
/// optional token-gated access, and optional coin-denominated hire payments.
/// The launchpad is the pool — trades settle against the launchpad's own
/// balances using bonding-curve math.
///
/// See ../../SPEC.md for the authoritative design document.
module tai::launchpad {

    // ============================= Error Codes =============================
    const EFeeBpsInvalid: u64 = 110;
    const EFeeBpsZero: u64 = 111;
    const ECredTargetZero: u64 = 113;
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
    public fun e_fee_bps_invalid(): u64 { EFeeBpsInvalid }
    public fun e_fee_bps_zero(): u64 { EFeeBpsZero }
    public fun e_cred_target_zero(): u64 { ECredTargetZero }
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

    // ============================= Test helpers ============================
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
