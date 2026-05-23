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
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
    use sui::event;
    use sui::sui::SUI;
    use std::string::String;
    use tai::agent_treasury;
    use tai::bonding_curve;
    use tai::fees;

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

    #[allow(unused_field)]
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

    #[allow(unused_field)]
    public struct ServicePaymentEvent has copy, drop {
        launchpad_id: ID,
        payer: address,
        sui_amount: u64,
        token_amount: u64,
        counted_toward_cred: bool,
        new_lifetime_revenue_sui: u64,
        timestamp: u64,
    }

    #[allow(unused_field)]
    public struct AccessConfigEvent has copy, drop {
        launchpad_id: ID,
        access_threshold: u64,
        accept_coin_payments: bool,
    }

    #[allow(unused_field)]
    public struct LinkedIdentityEvent has copy, drop {
        launchpad_id: ID,
        linked_identity: Option<ID>,
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

    // ============================= launch_agent_coin =======================
    /// Atomic launch: consume a fresh TreasuryCap<T>, mint the full supply,
    /// create LaunchpadAccount + TreasuryCapHolder + AgentTreasury, mint
    /// OwnerCap to `owner_cap_recipient`, optionally mint OperatorCap to
    /// `operator_recipient`, emit LaunchEvent, and share the three persistent
    /// objects.
    ///
    /// Mode is an emergent property of the recipient flags:
    ///   - sovereign:    owner_cap_recipient == operator_recipient
    ///   - commissioned: owner_cap_recipient != operator_recipient
    ///   - spawned:      caller is a parent agent's OperatorCap holder
    ///
    /// Authorization: holding a fresh TreasuryCap<T> is sufficient proof of
    /// authorship — only the original coin module's publisher can produce
    /// one.
    public fun launch_agent_coin<T>(
        config: &LaunchpadConfig,
        mut treasury_cap: TreasuryCap<T>,
        _metadata: &CoinMetadata<T>,
        coin_type_name: String,
        linked_identity: Option<ID>,
        owner_cap_recipient: address,
        operator_recipient: Option<address>,
        operator_daily_limit_sui: u64,
        operator_allowed_targets: vector<address>,
        operator_ttl_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(coin::total_supply(&treasury_cap) == 0, ETreasuryCapNotEmpty);

        let sender = ctx.sender();
        let sale_supply = config.sale_supply;
        let lp_supply = config.lp_supply;
        let total_supply = sale_supply + lp_supply;

        let sale_coin = coin::mint(&mut treasury_cap, sale_supply, ctx);
        let lp_coin = coin::mint(&mut treasury_cap, lp_supply, ctx);

        let now = clock::timestamp_ms(clock);

        // Allocate the LaunchpadAccount and TreasuryCapHolder UIDs first so
        // their IDs are available for cross-object linkage.
        let account_uid = object::new(ctx);
        let account_id = account_uid.to_inner();
        let holder_uid = object::new(ctx);
        let holder_id = holder_uid.to_inner();

        // Delegate treasury + cap creation to the agent_treasury module.
        let (treasury_id, owner_cap_id) =
            agent_treasury::build_treasury_owner_and_optional_operator<T>(
                account_id,
                owner_cap_recipient,
                operator_recipient,
                operator_daily_limit_sui,
                operator_allowed_targets,
                operator_ttl_ms,
                clock,
                ctx,
            );

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
            dwallets_object_id: option::none<ID>(),
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

    // ============================= buy =====================================
    /// Buy `T` tokens with `payment` SUI on the bonding curve.
    ///
    /// `min_tokens_out` enforces slippage protection. The fee is taken off
    /// the top of the payment and routed via `fees::distribute_sui` with the
    /// trade fee split (default 30/60/10 NAV/creator/platform).
    ///
    /// The resulting Coin<T> is transferred directly to the caller. PTB
    /// composability is intentionally a v1.5 expansion (will add a sibling
    /// `buy_return<T>` that returns Coin<T> instead).
    #[allow(lint(self_transfer))]
    public fun buy<T>(
        config: &LaunchpadConfig,
        account: &mut LaunchpadAccount<T>,
        payment: Coin<SUI>,
        min_tokens_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        let sui_in = coin::value(&payment);
        assert!(sui_in > 0, EInsufficientLiquidity);

        let (tokens_out, fee) = bonding_curve::compute_buy(
            balance::value(&account.real_sui_balance),
            balance::value(&account.real_token_balance),
            account.virtual_sui_reserves,
            account.virtual_token_reserves,
            sui_in,
            config.trade_fee_bps,
        );

        assert!(tokens_out >= min_tokens_out, ESlippageExceeded);
        assert!(balance::value(&account.real_token_balance) >= tokens_out, EInsufficientLiquidity);

        // Split payment: fee off the top, net SUI into the pool.
        let mut payment_balance = coin::into_balance(payment);
        let fee_balance = balance::split(&mut payment_balance, fee);
        balance::join(&mut account.real_sui_balance, payment_balance);

        // Distribute fee per trade-fee split.
        let split = fees::compute_split(
            fee,
            config.trade_nav_share_bps,
            config.trade_creator_share_bps,
        );
        fees::distribute_sui(
            fee_balance,
            split,
            &mut account.nav_sui,
            account.creator,
            config.platform_treasury,
            ctx,
        );

        // Pay out tokens.
        let token_balance = balance::split(&mut account.real_token_balance, tokens_out);
        transfer::public_transfer(coin::from_balance(token_balance, ctx), sender);

        // Counters.
        account.total_buys = account.total_buys + 1;
        account.cumulative_volume_sui = account.cumulative_volume_sui + sui_in;
        account.cumulative_fees_sui = account.cumulative_fees_sui + fee;

        let now = clock::timestamp_ms(clock);
        event::emit(TradeEvent {
            launchpad_id: object::id(account),
            trader: sender,
            is_buy: true,
            sui_in,
            tokens_out,
            sui_out: 0,
            tokens_in: 0,
            fee_sui: fee,
            new_real_sui_balance: balance::value(&account.real_sui_balance),
            new_real_token_balance: balance::value(&account.real_token_balance),
            timestamp: now,
        });
    }

    // ============================= sell ====================================
    /// Sell `tokens` back to the bonding curve for SUI.
    ///
    /// `min_sui_out` enforces slippage. The fee is taken off `sui_gross`
    /// (not off the tokens) and routed via `fees::distribute_sui` with the
    /// trade fee split. Resulting Coin<SUI> transferred directly to caller;
    /// see `buy` for the v1.5 composability note.
    #[allow(lint(self_transfer))]
    public fun sell<T>(
        config: &LaunchpadConfig,
        account: &mut LaunchpadAccount<T>,
        tokens: Coin<T>,
        min_sui_out: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let sender = ctx.sender();
        let tokens_in = coin::value(&tokens);
        assert!(tokens_in > 0, EInsufficientLiquidity);

        let (sui_out, fee) = bonding_curve::compute_sell(
            balance::value(&account.real_sui_balance),
            balance::value(&account.real_token_balance),
            account.virtual_sui_reserves,
            account.virtual_token_reserves,
            tokens_in,
            config.trade_fee_bps,
        );

        assert!(sui_out >= min_sui_out, ESlippageExceeded);
        assert!(
            balance::value(&account.real_sui_balance) >= sui_out + fee,
            EInsufficientLiquidity,
        );

        // Accept incoming tokens.
        balance::join(&mut account.real_token_balance, coin::into_balance(tokens));

        // Pay the seller.
        let payout = balance::split(&mut account.real_sui_balance, sui_out);
        transfer::public_transfer(coin::from_balance(payout, ctx), sender);

        // Take fee from the pool and distribute it.
        let fee_balance = balance::split(&mut account.real_sui_balance, fee);
        let split = fees::compute_split(
            fee,
            config.trade_nav_share_bps,
            config.trade_creator_share_bps,
        );
        fees::distribute_sui(
            fee_balance,
            split,
            &mut account.nav_sui,
            account.creator,
            config.platform_treasury,
            ctx,
        );

        // Counters.
        account.total_sells = account.total_sells + 1;
        account.cumulative_volume_sui = account.cumulative_volume_sui + sui_out + fee;
        account.cumulative_fees_sui = account.cumulative_fees_sui + fee;

        let now = clock::timestamp_ms(clock);
        event::emit(TradeEvent {
            launchpad_id: object::id(account),
            trader: sender,
            is_buy: false,
            sui_in: 0,
            tokens_out: 0,
            sui_out,
            tokens_in,
            fee_sui: fee,
            new_real_sui_balance: balance::value(&account.real_sui_balance),
            new_real_token_balance: balance::value(&account.real_token_balance),
            timestamp: now,
        });
    }

    // ============================= record_service_payment_sui ==============
    /// Record a SUI service payment to an agent. Permissionless to call.
    ///
    /// Routes the payment per the service-SUI split (default 40 NAV / 50
    /// creator / 10 platform). If the payer is not the agent's creator, the
    /// full payment amount is added to `lifetime_service_revenue_sui` (which
    /// drives the self-referential cred multiplier). Self-payments grow NAV
    /// but are excluded from cred — the most basic self-pump protection.
    public fun record_service_payment_sui<T>(
        config: &LaunchpadConfig,
        account: &mut LaunchpadAccount<T>,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let payer = ctx.sender();
        let amount = coin::value(&payment);
        assert!(amount > 0, EInsufficientLiquidity);

        let split = fees::compute_split(
            amount,
            config.service_nav_share_bps,
            config.service_creator_share_bps,
        );
        fees::distribute_sui(
            coin::into_balance(payment),
            split,
            &mut account.nav_sui,
            account.creator,
            config.platform_treasury,
            ctx,
        );

        let counted = payer != account.creator;
        if (counted) {
            account.lifetime_service_revenue_sui =
                account.lifetime_service_revenue_sui + amount;
        };
        account.total_service_payments_sui = account.total_service_payments_sui + 1;

        let now = clock::timestamp_ms(clock);
        event::emit(ServicePaymentEvent {
            launchpad_id: object::id(account),
            payer,
            sui_amount: amount,
            token_amount: 0,
            counted_toward_cred: counted,
            new_lifetime_revenue_sui: account.lifetime_service_revenue_sui,
            timestamp: now,
        });
    }

    // ============================= record_service_payment_token ============
    /// Record a token-denominated service payment.
    ///
    /// Requires `account.accept_coin_payments == true`. Routes the payment
    /// per the service-token split (default 40 NAV-in-T / 50 burn / 10
    /// creator). The burn portion is consumed via the wrapped TreasuryCap.
    ///
    /// Token payments do NOT contribute to `lifetime_service_revenue_sui` —
    /// the cred multiplier is denominated in SUI and only SUI-denominated
    /// revenue counts. Token payments still grow `nav_token` and burn supply.
    public fun record_service_payment_token<T>(
        config: &LaunchpadConfig,
        account: &mut LaunchpadAccount<T>,
        holder: &mut TreasuryCapHolder<T>,
        payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(account.accept_coin_payments, ECoinPaymentsDisabled);
        assert!(holder.launchpad_account_id == object::id(account), ELaunchpadMismatch);

        let amount = coin::value(&payment);
        assert!(amount > 0, EInsufficientLiquidity);

        let split = fees::compute_split(
            amount,
            config.token_service_nav_share_bps,
            config.token_service_creator_share_bps,
        );
        fees::distribute_token<T>(
            coin::into_balance(payment),
            split,
            &mut account.nav_token,
            holder_cap_mut(holder),
            account.creator,
            ctx,
        );

        account.total_service_payments_token = account.total_service_payments_token + 1;

        let payer = ctx.sender();
        let now = clock::timestamp_ms(clock);
        event::emit(ServicePaymentEvent {
            launchpad_id: object::id(account),
            payer,
            sui_amount: 0,
            token_amount: amount,
            counted_toward_cred: false,  // token payments never count toward SUI cred
            new_lifetime_revenue_sui: account.lifetime_service_revenue_sui,
            timestamp: now,
        });
    }

    // ============================= Access config ===========================
    /// Creator-only mutator for the productive-asset layer.
    public fun set_access_config<T>(
        account: &mut LaunchpadAccount<T>,
        threshold: u64,
        accept_coin: bool,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == account.creator, ENotCreator);
        account.access_threshold = threshold;
        account.accept_coin_payments = accept_coin;

        event::emit(AccessConfigEvent {
            launchpad_id: object::id(account),
            access_threshold: threshold,
            accept_coin_payments: accept_coin,
        });
    }

    /// Creator-only: set or clear the linked identity pointer.
    public fun set_linked_identity<T>(
        account: &mut LaunchpadAccount<T>,
        identity: Option<ID>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == account.creator, ENotCreator);
        account.linked_identity = identity;

        event::emit(LinkedIdentityEvent {
            launchpad_id: object::id(account),
            linked_identity: identity,
        });
    }

    // ============================= Test helpers ============================
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
