/// Module: fees
///
/// Pure split computation + balance distribution for the launchpad's three
/// fee policies (trade, service-SUI, service-token). All intermediate
/// products use u128 with explicit overflow assertions before downcast.
///
/// `Split` carries (nav, creator, platform_or_burn). For trade and
/// service-SUI splits, `platform_or_burn` is the platform share. For
/// service-token splits, it is the burn share. In all cases it also
/// absorbs the rounding remainder so the three parts sum to `total`
/// exactly.
module tai::fees {
    use sui::balance::{Self, Balance};
    use sui::coin;
    use sui::sui::SUI;
    use tai::launchpad::{Self as lp, LaunchpadConfig, TreasuryCapHolder};

    const EMathOverflow: u64 = 122;
    const MAX_U64: u128 = 18_446_744_073_709_551_615;

    public fun e_math_overflow(): u64 { EMathOverflow }

    public struct Split has copy, drop {
        nav: u64,
        creator: u64,
        platform_or_burn: u64,
    }

    public fun split_nav(s: &Split): u64 { s.nav }
    public fun split_creator(s: &Split): u64 { s.creator }
    public fun split_platform_or_burn(s: &Split): u64 { s.platform_or_burn }

    /// Internal: split `total` into (nav, creator, remainder).
    /// Remainder is computed as `total - nav - creator` so the three parts
    /// always sum exactly. Both multiplications use u128 intermediates.
    fun split_three(total: u64, nav_bps: u64, creator_bps: u64): Split {
        let nav_u128 = ((total as u128) * (nav_bps as u128)) / 10_000u128;
        let creator_u128 = ((total as u128) * (creator_bps as u128)) / 10_000u128;
        assert!(nav_u128 <= MAX_U64, EMathOverflow);
        assert!(creator_u128 <= MAX_U64, EMathOverflow);
        let nav = nav_u128 as u64;
        let creator = creator_u128 as u64;
        let platform_or_burn = total - nav - creator;
        Split { nav, creator, platform_or_burn }
    }

    public fun compute_trade_split(config: &LaunchpadConfig, total: u64): Split {
        split_three(
            total,
            lp::config_trade_nav_share_bps(config),
            lp::config_trade_creator_share_bps(config),
        )
    }

    public fun compute_service_sui_split(config: &LaunchpadConfig, total: u64): Split {
        split_three(
            total,
            lp::config_service_nav_share_bps(config),
            lp::config_service_creator_share_bps(config),
        )
    }

    public fun compute_token_service_split(config: &LaunchpadConfig, total: u64): Split {
        split_three(
            total,
            lp::config_token_service_nav_share_bps(config),
            lp::config_token_service_creator_share_bps(config),
        )
    }

    /// Distribute a SUI balance per a Split.
    ///   - NAV portion joins `nav_target`.
    ///   - creator portion is sent as Coin<SUI> to `creator_addr`.
    ///   - the remainder (platform share + any rounding) is sent to `platform_addr`.
    public fun distribute_sui(
        fee_balance: Balance<SUI>,
        s: Split,
        nav_target: &mut Balance<SUI>,
        creator_addr: address,
        platform_addr: address,
        ctx: &mut TxContext,
    ) {
        let mut fee = fee_balance;
        let nav_part = balance::split(&mut fee, s.nav);
        balance::join(nav_target, nav_part);

        let creator_part = balance::split(&mut fee, s.creator);
        transfer::public_transfer(coin::from_balance(creator_part, ctx), creator_addr);

        // Remaining balance is the platform share plus any rounding remainder.
        transfer::public_transfer(coin::from_balance(fee, ctx), platform_addr);
    }

    /// Distribute a token balance per a Split for service-token payments.
    ///   - NAV portion joins `nav_target_token`.
    ///   - creator portion is sent as Coin<T> to `creator_addr`.
    ///   - the remainder (burn share + any rounding) is BURNED via the
    ///     wrapped TreasuryCap. This is the only post-launch use of the cap.
    public fun distribute_token<T>(
        payment_balance: Balance<T>,
        s: Split,
        nav_target_token: &mut Balance<T>,
        holder: &mut TreasuryCapHolder<T>,
        creator_addr: address,
        ctx: &mut TxContext,
    ) {
        let mut payment = payment_balance;
        let nav_part = balance::split(&mut payment, s.nav);
        balance::join(nav_target_token, nav_part);

        let creator_part = balance::split(&mut payment, s.creator);
        transfer::public_transfer(coin::from_balance(creator_part, ctx), creator_addr);

        // Remaining is the burn share plus any rounding remainder.
        let burn_coin = coin::from_balance(payment, ctx);
        coin::burn(lp::holder_cap_mut(holder), burn_coin);
    }
}
