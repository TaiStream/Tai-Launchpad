#[test_only]
module tai::trade_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin;
    use sui::sui::SUI;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount};
    use tai::test_coin::{Self as tc, TEST_COIN};

    const ADMIN: address = @0xAD;
    const CREATOR: address = @0xC1;
    const BUYER: address = @0xB1;

    // ==========================================================
    //  Test fixtures
    // ==========================================================

    /// Launches a fresh sovereign-mode agent and leaves the test scenario at
    /// CREATOR ready for the next tx. Returns the clock.
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

    // ==========================================================
    //  Buy
    // ==========================================================

    #[test]
    fun buy_one_sui_credits_account_with_correct_split() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment, 1, &clock, ts::ctx(&mut sc));

        // 1% fee on 1 SUI = 10M MIST.
        // Trade split: 30/60/10 -> nav=3M, creator=6M, platform=1M.
        // Net 990M MIST joins real_sui_balance.
        assert!(lp::account_real_sui(&account) == 990_000_000, 0);
        assert!(lp::account_nav_sui(&account) == 3_000_000, 1);
        assert!(lp::account_cumulative_volume(&account) == 1_000_000_000, 2);
        assert!(lp::account_cumulative_fees(&account) == 10_000_000, 3);
        assert!(lp::account_total_buys(&account) == 1, 4);
        assert!(lp::account_real_token(&account) < 800_000_000_000_000_000, 5);

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ESlippageExceeded)]
    fun buy_with_min_out_too_high_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut sc));
        // Demand impossibly many tokens.
        lp::buy<TEST_COIN>(&config, &mut account, payment, 800_000_000_000_000_000, &clock, ts::ctx(&mut sc));

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EInsufficientLiquidity)]
    fun buy_with_zero_input_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment, 0, &clock, ts::ctx(&mut sc));

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ==========================================================
    //  Sell
    // ==========================================================

    #[test]
    fun sell_after_buy_pays_seller_and_increments_counter() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Buy first so the buyer holds Coin<TEST_COIN>.
        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(10_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment, 1, &clock, ts::ctx(&mut sc));

        // Sell those tokens back. The seller should receive strictly less
        // than 9.9 SUI (the post-fee net of the buy) due to fees on both legs.
        ts::next_tx(&mut sc, BUYER);
        let token_coin = ts::take_from_sender<coin::Coin<TEST_COIN>>(&sc);
        let real_sui_before_sell = lp::account_real_sui(&account);
        lp::sell<TEST_COIN>(&config, &mut account, token_coin, 1, &clock, ts::ctx(&mut sc));
        let real_sui_after_sell = lp::account_real_sui(&account);

        assert!(real_sui_after_sell < real_sui_before_sell, 0);
        assert!(lp::account_total_sells(&account) == 1, 1);
        // NAV grew from both legs.
        assert!(lp::account_nav_sui(&account) > 0, 2);

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ESlippageExceeded)]
    fun sell_with_min_out_too_high_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Buy first.
        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment, 1, &clock, ts::ctx(&mut sc));

        // Demand 1 SUI back — impossible after fees on both legs.
        ts::next_tx(&mut sc, BUYER);
        let token_coin = ts::take_from_sender<coin::Coin<TEST_COIN>>(&sc);
        lp::sell<TEST_COIN>(&config, &mut account, token_coin, 1_000_000_000, &clock, ts::ctx(&mut sc));

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EInsufficientLiquidity)]
    fun sell_with_zero_tokens_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let empty_tokens = coin::mint_for_testing<TEST_COIN>(0, ts::ctx(&mut sc));
        lp::sell<TEST_COIN>(&config, &mut account, empty_tokens, 0, &clock, ts::ctx(&mut sc));

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
