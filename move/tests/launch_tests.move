#[test_only]
module tai::launch_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use sui::coin;
    use sui::transfer;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount, TreasuryCapHolder};
    use tai::agent_treasury::{Self as treas, AgentTreasury, OwnerCap, OperatorCap};
    use tai::test_coin::{Self as tc, TEST_COIN};

    const ADMIN: address = @0xAD;
    const CREATOR: address = @0xC1;
    const HUMAN: address = @0xC0FFEE;
    const AGENT_RUNTIME: address = @0xA61;

    // =========================================================================
    //  Sovereign-mode launch — owner_cap_recipient == operator_recipient
    // =========================================================================

    #[test]
    fun launch_sovereign_mode_creates_all_objects_with_linkage() {
        let mut sc = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut sc));
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, CREATOR);
        let (cap, metadata) = tc::create_for_testing(ts::ctx(&mut sc));
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        lp::launch_agent_coin<TEST_COIN>(
            &config,
            cap,
            &metadata,
            std::string::utf8(b"0xTEST::test_coin::TEST_COIN"),
            option::none<ID>(),
            CREATOR,                    // owner_cap_recipient
            option::none<address>(),    // operator_recipient = none
            0, vector[], 0,             // operator scope unused
            &clock,
            ts::ctx(&mut sc),
        );

        ts::return_shared(config);
        transfer::public_share_object(metadata);

        // Inspect the resulting object graph.
        ts::next_tx(&mut sc, CREATOR);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let holder = ts::take_shared<TreasuryCapHolder<TEST_COIN>>(&sc);
        let treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);

        // Linkage invariants (bidirectional).
        let account_id = object::id(&account);
        assert!(lp::account_treasury_cap_holder_id(&account) == object::id(&holder), 0);
        assert!(lp::account_agent_treasury_id(&account) == object::id(&treasury), 1);
        assert!(lp::account_owner_cap_id(&account) == object::id(&owner_cap), 2);
        assert!(lp::account_dwallets_object_id(&account).is_none(), 3);
        assert!(treas::treasury_launchpad_account_id(&treasury) == account_id, 4);
        assert!(treas::treasury_owner_cap_id(&treasury) == object::id(&owner_cap), 5);
        assert!(lp::holder_launchpad_account_id(&holder) == account_id, 6);
        assert!(treas::owner_cap_agent_treasury_id(&owner_cap) == object::id(&treasury), 7);

        // No OperatorCap minted.
        assert!(treas::treasury_active_operator_cap_count(&treasury) == 0, 8);

        // Balances.
        assert!(lp::account_real_token(&account) == 800_000_000_000_000_000, 9);
        assert!(lp::account_lp_reserve(&account) == 200_000_000_000_000_000, 10);
        assert!(lp::account_real_sui(&account) == 0, 11);
        assert!(lp::account_nav_sui(&account) == 0, 12);
        assert!(lp::account_nav_token(&account) == 0, 13);
        assert!(treas::treasury_sui_balance(&treasury) == 0, 14);
        assert!(treas::treasury_token_balance(&treasury) == 0, 15);

        // Default access state.
        assert!(lp::account_access_threshold(&account) == 0, 16);
        assert!(lp::account_accept_coin_payments(&account) == false, 17);
        assert!(lp::account_lifetime_service_revenue(&account) == 0, 18);

        // Ownership snapshot.
        assert!(lp::account_creator(&account) == CREATOR, 19);
        assert!(lp::account_total_supply(&account) == 1_000_000_000_000_000_000, 20);
        assert!(lp::account_decimals(&account) == 9, 21);

        // Cred target snapshot from config.
        assert!(lp::account_cred_revenue_target(&account) == 1_000_000_000_000, 22);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(holder);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // =========================================================================
    //  Commissioned-mode launch — owner_cap to human, operator_cap to runtime
    // =========================================================================

    #[test]
    fun launch_commissioned_mode_distributes_caps_correctly() {
        let mut sc = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut sc));
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, HUMAN);
        let (cap, metadata) = tc::create_for_testing(ts::ctx(&mut sc));
        let config = ts::take_shared<LaunchpadConfig>(&sc);

        lp::launch_agent_coin<TEST_COIN>(
            &config, cap, &metadata,
            std::string::utf8(b"x"),
            option::none<ID>(),
            HUMAN,                                  // owner -> human
            option::some(AGENT_RUNTIME),            // operator -> agent runtime
            10_000_000_000,                         // 10 SUI daily limit
            vector[@0xDE57, @0xBEEF],               // allowlist
            30 * 86_400_000,                        // 30 days TTL
            &clock, ts::ctx(&mut sc),
        );
        ts::return_shared(config);
        transfer::public_share_object(metadata);

        // OwnerCap should arrive at HUMAN, OperatorCap at AGENT_RUNTIME.
        ts::next_tx(&mut sc, HUMAN);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, HUMAN);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, AGENT_RUNTIME);
        let treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);

        assert!(treas::treasury_active_operator_cap_count(&treasury) == 1, 0);
        assert!(treas::treasury_has_operator_cap(&treasury, object::id(&op_cap)), 1);
        assert!(treas::operator_cap_daily_limit(&op_cap) == 10_000_000_000, 2);
        assert!(treas::operator_cap_spent_today(&op_cap) == 0, 3);
        assert!(treas::operator_cap_allowed_targets(&op_cap).length() == 2, 4);
        assert!(treas::operator_cap_expires_at_ms(&op_cap) > 0, 5);

        // Caps reference the right treasury.
        assert!(treas::owner_cap_agent_treasury_id(&owner_cap) == object::id(&treasury), 6);
        assert!(treas::operator_cap_agent_treasury_id(&op_cap) == object::id(&treasury), 7);

        ts::return_to_address(HUMAN, owner_cap);
        ts::return_to_address(AGENT_RUNTIME, op_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // =========================================================================
    //  Abort: cap already minted
    // =========================================================================

    #[test]
    #[expected_failure(abort_code = tai::launchpad::ETreasuryCapNotEmpty)]
    fun launch_aborts_if_treasury_cap_already_minted() {
        let mut sc = ts::begin(ADMIN);
        let clock = clock::create_for_testing(ts::ctx(&mut sc));
        lp::init_for_testing(ts::ctx(&mut sc));

        ts::next_tx(&mut sc, CREATOR);
        let (mut cap, metadata) = tc::create_for_testing(ts::ctx(&mut sc));
        // Make the cap non-empty.
        let unwanted = coin::mint(&mut cap, 1, ts::ctx(&mut sc));
        transfer::public_transfer(unwanted, CREATOR);

        let config = ts::take_shared<LaunchpadConfig>(&sc);

        lp::launch_agent_coin<TEST_COIN>(
            &config, cap, &metadata,
            std::string::utf8(b"x"), option::none<ID>(),
            CREATOR, option::none<address>(),
            0, vector[], 0,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(config);
        transfer::public_share_object(metadata);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
