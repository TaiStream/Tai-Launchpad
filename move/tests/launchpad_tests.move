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
}
