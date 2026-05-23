#[test_only]
module tai::service_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_utils;
    use sui::transfer;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount, TreasuryCapHolder};
    use tai::test_coin::{Self as tc, TEST_COIN};

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

    // ==========================================================
    //  record_service_payment_sui
    // ==========================================================

    #[test]
    fun service_payment_sui_from_non_creator_grows_nav_and_lifetime() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // External hirer pays the agent.
        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(100_000_000, ts::ctx(&mut sc));
        lp::record_service_payment_sui<TEST_COIN>(&config, &mut account, payment, &clock, ts::ctx(&mut sc));

        // Service-SUI split = 40 / 50 / 10 on 100M MIST.
        assert!(lp::account_nav_sui(&account) == 40_000_000, 0);
        assert!(lp::account_lifetime_service_revenue(&account) == 100_000_000, 1);
        assert!(lp::account_total_service_payments_sui(&account) == 1, 2);

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun service_payment_sui_from_creator_grows_nav_but_excludes_from_cred() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Creator pays themselves (self-pump attempt).
        ts::next_tx(&mut sc, CREATOR);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(100_000_000, ts::ctx(&mut sc));
        lp::record_service_payment_sui<TEST_COIN>(&config, &mut account, payment, &clock, ts::ctx(&mut sc));

        // NAV grows (40M MIST), but lifetime_service_revenue does NOT.
        assert!(lp::account_nav_sui(&account) == 40_000_000, 0);
        assert!(lp::account_lifetime_service_revenue(&account) == 0, 1);
        assert!(lp::account_total_service_payments_sui(&account) == 1, 2);

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::EInsufficientLiquidity)]
    fun service_payment_sui_with_zero_amount_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut sc));
        lp::record_service_payment_sui<TEST_COIN>(&config, &mut account, payment, &clock, ts::ctx(&mut sc));

        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ==========================================================
    //  record_service_payment_token (with burn)
    // ==========================================================

    #[test]
    fun service_payment_token_burns_share_and_grows_nav_token() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Creator enables coin payments.
        ts::next_tx(&mut sc, CREATOR);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        lp::set_access_config<TEST_COIN>(&mut account, 0, true, ts::ctx(&mut sc));

        // Hirer buys tokens to use as payment.
        ts::next_tx(&mut sc, HIRER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment_sui = coin::mint_for_testing<SUI>(100_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment_sui, 1, &clock, ts::ctx(&mut sc));

        // Pay the agent in T.
        ts::next_tx(&mut sc, HIRER);
        let token_coin = ts::take_from_sender<Coin<TEST_COIN>>(&sc);
        let token_amount = coin::value(&token_coin);
        let mut holder = ts::take_shared<TreasuryCapHolder<TEST_COIN>>(&sc);
        lp::record_service_payment_token<TEST_COIN>(
            &config, &mut account, &mut holder, token_coin, &clock, ts::ctx(&mut sc),
        );

        // Token-service split: 40 nav / 10 creator / 50 burn.
        // Use u128 arithmetic because token_amount * 4000 overflows u64.
        let expected_nav = ((token_amount as u128) * 4000u128 / 10_000u128) as u64;
        assert!(lp::account_nav_token(&account) == expected_nav, 0);
        assert!(lp::account_total_service_payments_token(&account) == 1, 1);
        // Lifetime SUI revenue still 0 — token payments don't pump cred.
        assert!(lp::account_lifetime_service_revenue(&account) == 0, 2);

        ts::return_shared(holder);
        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ENotCreator)]
    fun non_creator_cannot_set_access_config() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        lp::set_access_config<TEST_COIN>(&mut account, 100, true, ts::ctx(&mut sc));

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun creator_sets_linked_identity_and_can_clear_it() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);

        // Set a new identity.
        let new_id = object::id_from_address(@0xDEADBEEF);
        lp::set_linked_identity<TEST_COIN>(&mut account, option::some(new_id), ts::ctx(&mut sc));
        let li = lp::account_linked_identity(&account);
        assert!(li.is_some(), 0);
        assert!(*li.borrow() == new_id, 1);

        // Clear it.
        lp::set_linked_identity<TEST_COIN>(&mut account, option::none<ID>(), ts::ctx(&mut sc));
        let li_after = lp::account_linked_identity(&account);
        assert!(li_after.is_none(), 2);

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ENotCreator)]
    fun non_creator_cannot_set_linked_identity() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        lp::set_linked_identity<TEST_COIN>(
            &mut account,
            option::some(object::id_from_address(@0xC0DE)),
            ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ELaunchpadMismatch)]
    fun service_payment_token_aborts_on_mismatched_holder() {
        // The bidirectional linkage between LaunchpadAccount<T> and
        // TreasuryCapHolder<T> is established at launch and immutable. To
        // exercise the ELaunchpadMismatch assertion (which catches a holder
        // paired with a foreign account), we use a test-only constructor
        // that synthesizes a TreasuryCapHolder<TEST_COIN> with a fabricated
        // launchpad_account_id.
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Enable coin payments + buy some tokens.
        ts::next_tx(&mut sc, CREATOR);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        lp::set_access_config<TEST_COIN>(&mut account, 0, true, ts::ctx(&mut sc));

        ts::next_tx(&mut sc, HIRER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment_sui = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment_sui, 1, &clock, ts::ctx(&mut sc));

        // Construct a foreign holder by minting a SECOND fresh TreasuryCap
        // (via the test_coin helper, which is reusable in tests because we're
        // outside production OTW restrictions) and wrapping it.
        ts::next_tx(&mut sc, HIRER);
        let token_coin = ts::take_from_sender<Coin<TEST_COIN>>(&sc);
        let (foreign_cap, foreign_meta) = tc::create_for_testing(ts::ctx(&mut sc));
        let mut foreign_holder = lp::test_only_wrap_holder<TEST_COIN>(
            foreign_cap,
            object::id_from_address(@0xFA1DE7),   // fabricated foreign account id
            ts::ctx(&mut sc),
        );

        // Now the call should abort with ELaunchpadMismatch.
        lp::record_service_payment_token<TEST_COIN>(
            &config, &mut account, &mut foreign_holder, token_coin, &clock, ts::ctx(&mut sc),
        );

        // Unreachable due to expected_failure, but required for type-checking.
        test_utils::destroy(foreign_meta);
        test_utils::destroy(foreign_holder);
        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ECoinPaymentsDisabled)]
    fun service_payment_token_aborts_when_not_enabled() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Hirer buys tokens; coin payments NOT enabled.
        ts::next_tx(&mut sc, HIRER);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let payment_sui = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut sc));
        lp::buy<TEST_COIN>(&config, &mut account, payment_sui, 1, &clock, ts::ctx(&mut sc));

        ts::next_tx(&mut sc, HIRER);
        let token_coin = ts::take_from_sender<Coin<TEST_COIN>>(&sc);
        let mut holder = ts::take_shared<TreasuryCapHolder<TEST_COIN>>(&sc);

        // Should abort with ECoinPaymentsDisabled.
        lp::record_service_payment_token<TEST_COIN>(
            &config, &mut account, &mut holder, token_coin, &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(holder);
        ts::return_shared(account);
        ts::return_shared(config);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
