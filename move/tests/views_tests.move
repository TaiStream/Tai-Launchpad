#[test_only]
module tai::views_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;
    use sui::transfer;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount};
    use tai::test_coin::{Self as tc, TEST_COIN};
    use tai::views;

    const ADMIN: address = @0xAD;
    const CREATOR: address = @0xC1;
    const HIRER: address = @0xCAFE;

    fun launch_fresh(sc: &mut Scenario): Clock {
        let clock = clock::create_for_testing(ts::ctx(sc));
        lp::init_for_testing(ts::ctx(sc));

        ts::next_tx(sc, CREATOR);
        let (cap, metadata) = tc::create_for_testing(ts::ctx(sc));
        let config = ts::take_shared<LaunchpadConfig>(sc);
        lp::launch_agent_coin<TEST_COIN>(
            &config, cap, &metadata,
            std::string::utf8(b"x"),
            option::none<ID>(),
            CREATOR,
            option::none<address>(),
            0, vector[], 0,
            &clock, ts::ctx(sc),
        );
        ts::return_shared(config);
        transfer::public_share_object(metadata);
        clock
    }

    /// Cause `lifetime_service_revenue_sui` to equal exactly `target_sui`.
    fun pump_service_revenue(sc: &mut Scenario, clock: &Clock, account: &mut LaunchpadAccount<TEST_COIN>, config: &LaunchpadConfig, target_sui: u64) {
        ts::next_tx(sc, HIRER);
        let payment = coin::mint_for_testing<SUI>(target_sui, ts::ctx(sc));
        lp::record_service_payment_sui<TEST_COIN>(config, account, payment, clock, ts::ctx(sc));
    }

    // ==========================================================
    //  effective_hire_price + hire_quote
    // ==========================================================

    #[test]
    fun hire_price_at_zero_revenue_equals_nav_at_one_x() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Trade fees push NAV up but lifetime_revenue stays at 0.
        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(100_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment, 1, &clock, ts::ctx(&mut sc));

        let nav = lp::account_nav_sui(&account);
        let hp = views::effective_hire_price<TEST_COIN>(&account);
        assert!(nav > 0, 0);
        assert!(hp == nav, 1);    // multiplier = 1.0x

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun hire_price_at_exact_target_revenue_doubles_nav() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        pump_service_revenue(&mut sc, &clock, &mut account, &config, 1_000_000_000_000);

        let nav = lp::account_nav_sui(&account);
        assert!(lp::account_lifetime_service_revenue(&account) == 1_000_000_000_000, 0);

        let hp = views::effective_hire_price<TEST_COIN>(&account);
        assert!(hp == 2 * nav, 1);    // multiplier = 2.0x

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun hire_price_above_target_saturates_at_two_x() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        // 2x target = 2000 SUI lifetime revenue.
        pump_service_revenue(&mut sc, &clock, &mut account, &config, 2_000_000_000_000);

        let nav = lp::account_nav_sui(&account);
        let hp = views::effective_hire_price<TEST_COIN>(&account);
        assert!(hp == 2 * nav, 0);   // saturated, still 2.0x

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun hire_quote_returns_full_tuple() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);

        let (nav, earned, target, mult_bps, hp) = views::hire_quote<TEST_COIN>(&account);
        assert!(nav == 0, 0);
        assert!(earned == 0, 1);
        assert!(target == 1_000_000_000_000, 2);
        assert!(mult_bps == 10_000, 3);   // 1.0x baseline
        assert!(hp == 0, 4);

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun hire_quote_after_partial_revenue_returns_linear_bonus() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        // 25% of target = 250 SUI -> mult_bps should be 10000 + 2500 = 12500.
        pump_service_revenue(&mut sc, &clock, &mut account, &config, 250_000_000_000);

        let (_nav, earned, target, mult_bps, _hp) = views::hire_quote<TEST_COIN>(&account);
        assert!(earned == 250_000_000_000, 0);
        assert!(target == 1_000_000_000_000, 1);
        assert!(mult_bps == 12_500, 2);

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
