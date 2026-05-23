/// Module: views
///
/// Read-only views over a `LaunchpadAccount<T>`. Headline product surface:
/// the self-referential hire-price multiplier, derived from the agent's
/// own lifetime SUI service revenue. No external dependency on SAI; the
/// optional Tai-SAI-Adapter (v1.5) composes SAI cred multiplicatively on
/// top of this baseline.
///
/// See SPEC §5.7.
module tai::views {
    use tai::launchpad::{Self as lp, LaunchpadAccount};

    const EMathOverflow: u64 = 122;
    const MAX_U64: u128 = 18_446_744_073_709_551_615;
    const BPS_BASE: u128 = 10_000;
    const BPS_CAP: u128 = 10_000;          // bonus saturates at +1.0x (total 2.0x)

    public fun e_math_overflow(): u64 { EMathOverflow }

    /// hire_price = nav * mult_bps / 10_000
    /// mult_bps   = 10_000 + min(10_000, earned * 10_000 / target)
    ///
    /// At zero lifetime revenue: mult = 1.0x, hire_price = nav.
    /// At target revenue:        mult = 2.0x, hire_price = 2 * nav.
    /// Above target:             mult saturates at 2.0x.
    public fun effective_hire_price<T>(account: &LaunchpadAccount<T>): u64 {
        let (_nav, _earned, _target, _mult, hp) = quote_internal(account);
        hp
    }

    /// Convenience: returns (nav_sui, lifetime_revenue_sui, cred_revenue_target,
    /// multiplier_bps, hire_price). One call serves UI/CLI/SDK.
    public fun hire_quote<T>(account: &LaunchpadAccount<T>): (u64, u64, u64, u64, u64) {
        quote_internal(account)
    }

    fun quote_internal<T>(account: &LaunchpadAccount<T>): (u64, u64, u64, u64, u64) {
        let nav    = lp::account_nav_sui(account);
        let earned = lp::account_lifetime_service_revenue(account);
        let target = lp::account_cred_revenue_target(account);

        // Cred bonus. target is guaranteed >0 by config invariant (ECredTargetZero).
        let bonus_u128 = ((earned as u128) * BPS_BASE) / (target as u128);
        let capped_bonus = if (bonus_u128 > BPS_CAP) BPS_CAP else bonus_u128;
        let mult_bps_u128 = BPS_BASE + capped_bonus;
        assert!(mult_bps_u128 <= MAX_U64, EMathOverflow);
        let mult_bps = mult_bps_u128 as u64;

        let hp_u128 = (nav as u128) * mult_bps_u128 / BPS_BASE;
        assert!(hp_u128 <= MAX_U64, EMathOverflow);
        let hp = hp_u128 as u64;

        (nav, earned, target, mult_bps, hp)
    }
}
