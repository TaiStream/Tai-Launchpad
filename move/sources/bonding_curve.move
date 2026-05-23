/// Module: bonding_curve
///
/// Pure constant-product math with virtual reserves. The launchpad is the
/// pool: trades settle against `LaunchpadAccount<T>`'s real SUI + token
/// balances paired with snapshotted virtual reserves.
///
/// All intermediate products use u128. Every downcast to u64 is preceded by
/// an explicit overflow assertion. This is non-negotiable per SPEC §10
/// (Security considerations).
module tai::bonding_curve {

    const EMathOverflow: u64 = 122;

    /// 2^64 - 1, the maximum u64 value used for overflow assertions.
    const MAX_U64: u128 = 18_446_744_073_709_551_615;

    public fun e_math_overflow(): u64 { EMathOverflow }

    /// Compute tokens received and fee for a buy.
    ///
    /// Returns (tokens_out, fee_sui), both in their respective smallest units
    /// (base token units for `tokens_out`, MIST for `fee_sui`).
    ///
    /// Invariants:
    ///   total_sui    = real_sui + virtual_sui
    ///   total_token  = real_token + virtual_token
    ///   k            = total_sui * total_token
    ///   sui_net      = sui_in - fee
    ///   new_total_sui   = total_sui + sui_net
    ///   new_total_token = k / new_total_sui
    ///   tokens_out      = total_token - new_total_token
    public fun compute_buy(
        real_sui: u64,
        real_token: u64,
        virtual_sui: u64,
        virtual_token: u64,
        sui_in: u64,
        fee_bps: u64,
    ): (u64, u64) {
        if (sui_in == 0) {
            return (0, 0)
        };

        let fee_u128 = ((sui_in as u128) * (fee_bps as u128)) / 10_000u128;
        assert!(fee_u128 <= MAX_U64, EMathOverflow);
        let fee = fee_u128 as u64;
        let sui_net = sui_in - fee;

        let total_sui   = (real_sui   as u128) + (virtual_sui   as u128);
        let total_token = (real_token as u128) + (virtual_token as u128);
        let k = total_sui * total_token;

        let new_total_sui = total_sui + (sui_net as u128);
        let new_total_token = k / new_total_sui;

        let tokens_out_u128 = total_token - new_total_token;
        assert!(tokens_out_u128 <= (real_token as u128), EMathOverflow);
        (tokens_out_u128 as u64, fee)
    }
}
