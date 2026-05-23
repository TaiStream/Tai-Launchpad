#[test_only]
module tai::bonding_curve_tests {
    use tai::bonding_curve;

    // ============================================================
    //  Buy-side math
    // ============================================================

    #[test]
    fun buy_at_initial_state_returns_expected_tokens() {
        // Initial state: virtual=10k SUI / 1.073B tokens, real=0/800M.
        // Buy with 1 SUI (1e9 MIST), fee_bps = 100 (1%).
        let (tokens_out, fee) = bonding_curve::compute_buy(
            0,                              // real_sui
            800_000_000_000_000_000,        // real_token (sale_supply, untouched)
            10_000_000_000_000,             // virtual_sui
            1_073_000_000_000_000_000,      // virtual_token
            1_000_000_000,                  // sui_in (1 SUI)
            100,                            // fee_bps
        );
        // 1% of 1 SUI is 10M MIST fee
        assert!(fee == 10_000_000, 0);
        // tokens_out must be > 0 and <= sale supply
        assert!(tokens_out > 0, 1);
        assert!(tokens_out < 800_000_000_000_000_000, 2);
    }

    #[test]
    fun buy_with_zero_sui_returns_zero() {
        let (tokens_out, fee) = bonding_curve::compute_buy(
            0, 800_000_000_000_000_000,
            10_000_000_000_000, 1_073_000_000_000_000_000,
            0, 100,
        );
        assert!(tokens_out == 0, 0);
        assert!(fee == 0, 1);
    }

    #[test]
    fun buy_after_some_real_reserves_is_more_expensive() {
        let (tokens_a, _) = bonding_curve::compute_buy(
            0,
            800_000_000_000_000_000,
            10_000_000_000_000, 1_073_000_000_000_000_000,
            1_000_000_000, 100,
        );
        let (tokens_b, _) = bonding_curve::compute_buy(
            5_000_000_000_000,              // real_sui = 5k SUI
            500_000_000_000_000_000,        // real_token already reduced
            10_000_000_000_000, 1_073_000_000_000_000_000,
            1_000_000_000, 100,
        );
        assert!(tokens_a > tokens_b, 0);
    }

    #[test]
    fun buy_huge_input_uses_u128_for_fee_calc() {
        // Forces the u128 path: sui_in * fee_bps = 1e18 * 100 = 1e20,
        // which overflows u64 (max ~1.84e19). u128 intermediate must handle it.
        // Synthetic large pool keeps tokens_out within real_token.
        let (tokens_out, fee) = bonding_curve::compute_buy(
            0,                                    // real_sui
            1_000_000_000_000_000_000,            // real_token = 1e18
            1_000_000_000_000_000_000,            // virtual_sui = 1e18
            1_000_000_000_000_000_000,            // virtual_token = 1e18
            1_000_000_000_000_000_000,            // sui_in = 1e18
            100,                                  // fee_bps = 1%
        );
        // 1% of 1e18 = 1e16
        assert!(fee == 10_000_000_000_000_000, 0);
        assert!(tokens_out > 0, 1);
        assert!(tokens_out < 1_000_000_000_000_000_000, 2);
    }

    #[test]
    #[expected_failure(abort_code = tai::bonding_curve::EMathOverflow)]
    fun buy_that_would_exhaust_real_token_aborts() {
        // Trying to extract more tokens than the pool physically holds — the
        // tokens_out <= real_token guard must abort with EMathOverflow.
        // (In production this is also gated upstream by EInsufficientLiquidity
        //  in launchpad::buy; the curve-level guard is a belt-and-suspenders.)
        let (_t, _f) = bonding_curve::compute_buy(
            0,
            800_000_000_000_000_000,
            10_000_000_000_000,
            1_073_000_000_000_000_000,
            100_000_000_000_000_000,   // 100M SUI — way too much
            100,
        );
    }

    // ============================================================
    //  Sell-side math
    // ============================================================

    #[test]
    fun sell_after_buy_returns_less_than_paid() {
        // Path-dependence sanity: buy 1 SUI worth, then sell the tokens back.
        // Seller must receive strictly less than the original 990M MIST net
        // (fees on both legs).
        let (tokens_out, _fee_buy) = bonding_curve::compute_buy(
            0, 800_000_000_000_000_000,
            10_000_000_000_000, 1_073_000_000_000_000_000,
            1_000_000_000, 100,
        );

        let real_sui_after = 990_000_000;
        let real_token_after = 800_000_000_000_000_000 - tokens_out;

        let (sui_out, _fee_sell) = bonding_curve::compute_sell(
            real_sui_after,
            real_token_after,
            10_000_000_000_000,
            1_073_000_000_000_000_000,
            tokens_out,
            100,
        );
        assert!(sui_out < 990_000_000, 0);
        assert!(sui_out > 0, 1);
    }

    #[test]
    fun sell_with_zero_tokens_returns_zero() {
        let (sui_out, fee) = bonding_curve::compute_sell(
            1_000_000_000, 700_000_000_000_000_000,
            10_000_000_000_000, 1_073_000_000_000_000_000,
            0, 100,
        );
        assert!(sui_out == 0, 0);
        assert!(fee == 0, 1);
    }

    #[test]
    fun sell_huge_amount_uses_u128_for_fee_calc() {
        // Synthetic large pool so the sell math exercises u128 multiplication
        // without aborting on the real_sui guard.
        // sui_gross close to 1e18; sui_gross * fee_bps = 1e20 overflows u64.
        let (sui_out, fee) = bonding_curve::compute_sell(
            2_000_000_000_000_000_000,            // real_sui = 2e18
            1_000_000_000_000_000_000,            // real_token = 1e18
            1_000_000_000_000_000_000,            // virtual_sui = 1e18
            1_000_000_000_000_000_000,            // virtual_token = 1e18
            500_000_000_000_000_000,              // tokens_in = 5e17
            100,                                  // fee_bps = 1%
        );
        assert!(sui_out > 0, 0);
        assert!(fee > 0, 1);
    }

    #[test]
    #[expected_failure(abort_code = tai::bonding_curve::EMathOverflow)]
    fun sell_that_would_drain_real_sui_aborts() {
        // sui_gross exceeds real_sui — must abort at the curve layer.
        let (_s, _f) = bonding_curve::compute_sell(
            100,                                  // real_sui = trivially small
            800_000_000_000_000_000,
            10_000_000_000_000,
            1_073_000_000_000_000_000,
            500_000_000_000_000_000,              // huge tokens_in
            100,
        );
    }
}
