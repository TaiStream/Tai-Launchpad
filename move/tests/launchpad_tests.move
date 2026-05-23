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

        // Trade-fee defaults (SPEC §8)
        assert!(launchpad::config_admin(&config) == ADMIN, 0);
        assert!(launchpad::config_platform_treasury(&config) == ADMIN, 1);
        assert!(launchpad::config_trade_fee_bps(&config) == 100, 2);
        assert!(launchpad::config_trade_nav_share_bps(&config) == 3000, 3);
        assert!(launchpad::config_trade_creator_share_bps(&config) == 6000, 4);
        assert!(launchpad::config_trade_platform_share_bps(&config) == 1000, 5);

        // Service-SUI fee defaults
        assert!(launchpad::config_service_nav_share_bps(&config) == 4000, 6);
        assert!(launchpad::config_service_creator_share_bps(&config) == 5000, 7);
        assert!(launchpad::config_service_platform_share_bps(&config) == 1000, 8);

        // Service-token fee defaults
        assert!(launchpad::config_token_service_nav_share_bps(&config) == 4000, 9);
        assert!(launchpad::config_token_service_burn_share_bps(&config) == 5000, 10);
        assert!(launchpad::config_token_service_creator_share_bps(&config) == 1000, 11);

        // Curve defaults
        assert!(launchpad::config_virtual_sui_reserves(&config) == 10_000_000_000_000, 12);
        assert!(launchpad::config_virtual_token_reserves(&config) == 1_073_000_000_000_000_000, 13);
        assert!(launchpad::config_sale_supply(&config) == 800_000_000_000_000_000, 14);
        assert!(launchpad::config_lp_supply(&config) == 200_000_000_000_000_000, 15);

        // Cred multiplier target
        assert!(launchpad::config_cred_revenue_target(&config) == 1_000_000_000_000, 16);

        ts::return_shared(config);
        ts::end(sc);
    }

    // =========================================================================
    //  Admin entry functions
    // =========================================================================

    const NEW_ADMIN: address = @0xBE;
    const NEW_TREASURY: address = @0xCA;

    #[test]
    fun admin_sets_platform_treasury() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_platform_treasury(&mut config, NEW_TREASURY, ts::ctx(&mut sc));
        assert!(launchpad::config_platform_treasury(&config) == NEW_TREASURY, 0);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ENotAdmin)]
    fun non_admin_cannot_set_treasury() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, NEW_ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_platform_treasury(&mut config, NEW_TREASURY, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_sets_trade_shares() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_trade_shares(&mut config, 4000, 5000, 1000, ts::ctx(&mut sc));
        assert!(launchpad::config_trade_nav_share_bps(&config) == 4000, 0);
        assert!(launchpad::config_trade_creator_share_bps(&config) == 5000, 1);
        assert!(launchpad::config_trade_platform_share_bps(&config) == 1000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EFeeBpsInvalid)]
    fun trade_shares_must_sum_to_10000() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        // 4000 + 5000 + 999 = 9999, must fail.
        launchpad::set_trade_shares(&mut config, 4000, 5000, 999, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_sets_service_shares() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_service_shares(&mut config, 5000, 4000, 1000, ts::ctx(&mut sc));
        assert!(launchpad::config_service_nav_share_bps(&config) == 5000, 0);
        assert!(launchpad::config_service_creator_share_bps(&config) == 4000, 1);
        assert!(launchpad::config_service_platform_share_bps(&config) == 1000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EFeeBpsInvalid)]
    fun service_shares_must_sum_to_10000() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_service_shares(&mut config, 5000, 4000, 999, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_sets_token_service_shares() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_token_service_shares(&mut config, 3000, 6000, 1000, ts::ctx(&mut sc));
        assert!(launchpad::config_token_service_nav_share_bps(&config) == 3000, 0);
        assert!(launchpad::config_token_service_burn_share_bps(&config) == 6000, 1);
        assert!(launchpad::config_token_service_creator_share_bps(&config) == 1000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EFeeBpsInvalid)]
    fun token_service_shares_must_sum_to_10000() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_token_service_shares(&mut config, 3000, 6000, 999, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_sets_trade_fee_bps() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_trade_fee_bps(&mut config, 200, ts::ctx(&mut sc));
        assert!(launchpad::config_trade_fee_bps(&config) == 200, 0);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EFeeBpsZero)]
    fun trade_fee_cannot_be_zero() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_trade_fee_bps(&mut config, 0, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_sets_cred_revenue_target() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_cred_revenue_target(&mut config, 500_000_000_000, ts::ctx(&mut sc));
        assert!(launchpad::config_cred_revenue_target(&config) == 500_000_000_000, 0);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ECredTargetZero)]
    fun cred_target_cannot_be_zero() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::set_cred_revenue_target(&mut config, 0, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun admin_transfers_admin() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::transfer_admin(&mut config, NEW_ADMIN, ts::ctx(&mut sc));
        assert!(launchpad::config_admin(&config) == NEW_ADMIN, 0);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ENotAdmin)]
    fun non_admin_cannot_transfer_admin() {
        let mut sc = ts::begin(ADMIN);
        launchpad::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, NEW_ADMIN);
        let mut config = ts::take_shared<LaunchpadConfig>(&sc);
        launchpad::transfer_admin(&mut config, NEW_ADMIN, ts::ctx(&mut sc));

        ts::return_shared(config);
        ts::end(sc);
    }
}
