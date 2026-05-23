#[test_only]
module tai::fees_tests {
    use sui::test_scenario::{Self as ts};
    use tai::launchpad::{Self as lp, LaunchpadConfig};
    use tai::fees;

    const ADMIN: address = @0xAD;

    #[test]
    fun trade_split_matches_defaults() {
        let mut sc = ts::begin(ADMIN);
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        // Trade: 30 / 60 / 10 on 1M MIST.
        let split = fees::compute_split(
            1_000_000,
            lp::config_trade_nav_share_bps(&config),
            lp::config_trade_creator_share_bps(&config),
        );
        assert!(fees::split_nav(&split) == 300_000, 0);
        assert!(fees::split_creator(&split) == 600_000, 1);
        assert!(fees::split_platform_or_burn(&split) == 100_000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun service_sui_split_matches_defaults() {
        let mut sc = ts::begin(ADMIN);
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        // Service-SUI: 40 / 50 / 10 on 1M.
        let split = fees::compute_split(
            1_000_000,
            lp::config_service_nav_share_bps(&config),
            lp::config_service_creator_share_bps(&config),
        );
        assert!(fees::split_nav(&split) == 400_000, 0);
        assert!(fees::split_creator(&split) == 500_000, 1);
        assert!(fees::split_platform_or_burn(&split) == 100_000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun token_service_split_matches_defaults() {
        let mut sc = ts::begin(ADMIN);
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        // Service-token: 40 nav / 10 creator / 50 burn (platform_or_burn).
        let split = fees::compute_split(
            1_000_000,
            lp::config_token_service_nav_share_bps(&config),
            lp::config_token_service_creator_share_bps(&config),
        );
        assert!(fees::split_nav(&split) == 400_000, 0);
        assert!(fees::split_creator(&split) == 100_000, 1);
        assert!(fees::split_platform_or_burn(&split) == 500_000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun split_handles_huge_amounts_without_overflow() {
        let mut sc = ts::begin(ADMIN);
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        // 1e17 MIST. Plain u64: total * 4000 = 4e20 overflows u64.
        let split = fees::compute_split(
            100_000_000_000_000_000,
            lp::config_service_nav_share_bps(&config),
            lp::config_service_creator_share_bps(&config),
        );
        assert!(fees::split_nav(&split) == 40_000_000_000_000_000, 0);
        assert!(fees::split_creator(&split) == 50_000_000_000_000_000, 1);
        assert!(fees::split_platform_or_burn(&split) == 10_000_000_000_000_000, 2);

        ts::return_shared(config);
        ts::end(sc);
    }

    #[test]
    fun split_remainder_goes_to_platform_or_burn() {
        // total=1 with 30/60/10 -> nav=0, creator=0, remainder=1.
        let split = fees::compute_split(1, 3000, 6000);
        assert!(fees::split_nav(&split) == 0, 0);
        assert!(fees::split_creator(&split) == 0, 1);
        assert!(fees::split_platform_or_burn(&split) == 1, 2);
    }
}
