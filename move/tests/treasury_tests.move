#[test_only]
module tai::treasury_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::transfer;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount};
    use tai::agent_treasury::{Self as treas, AgentTreasury, OwnerCap, OperatorCap};
    use tai::test_coin::{Self as tc, TEST_COIN};

    const ADMIN: address = @0xAD;
    const CREATOR: address = @0xC1;
    const ATTACKER: address = @0xBADD;
    const OPERATOR: address = @0xA61;
    const RECIPIENT_A: address = @0xCAFE;
    const RECIPIENT_B: address = @0xBEEF;
    const FORBIDDEN: address = @0xDEAD;

    // Default OperatorCap scope in tests:
    //   - daily_limit = 10 SUI
    //   - allowlist = [RECIPIENT_A, RECIPIENT_B]
    //   - ttl = 30 days
    const TEN_SUI_MIST: u64 = 10_000_000_000;
    const THIRTY_DAYS_MS: u64 = 30 * 86_400_000;

    // ==========================================================
    //  Fixtures
    // ==========================================================

    /// Sovereign launch where CREATOR holds OwnerCap; treasury empty.
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
            0, 0, vector[], 0,
            &clock, ts::ctx(sc),
        );
        ts::return_shared(config);
        transfer::public_share_object(metadata);
        clock
    }

    /// Fund the treasury with `amount` MIST of SUI via permissionless top-up.
    fun fund_treasury_sui(sc: &mut Scenario, treasury: &mut AgentTreasury<TEST_COIN>, amount: u64) {
        ts::next_tx(sc, CREATOR);
        let payment = coin::mint_for_testing<SUI>(amount, ts::ctx(sc));
        treas::top_up_sui<TEST_COIN>(treasury, payment);
    }

    // ==========================================================
    //  OwnerCap-gated withdraw
    // ==========================================================

    #[test]
    fun owner_withdraws_sui_to_arbitrary_address() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        fund_treasury_sui(&mut sc, &mut treasury, 5_000_000_000);  // 5 SUI

        ts::next_tx(&mut sc, CREATOR);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        treas::withdraw_sui<TEST_COIN>(&mut treasury, &owner_cap, 2_000_000_000, RECIPIENT_A, ts::ctx(&mut sc));

        assert!(treas::treasury_sui_balance(&treasury) == 3_000_000_000, 0);

        // Verify the recipient received it.
        ts::next_tx(&mut sc, RECIPIENT_A);
        let payout = ts::take_from_address<Coin<SUI>>(&sc, RECIPIENT_A);
        assert!(coin::value(&payout) == 2_000_000_000, 1);
        ts::return_to_address(RECIPIENT_A, payout);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun owner_withdraws_token_to_arbitrary_address() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Fund with tokens via top_up_token.
        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let tokens = coin::mint_for_testing<TEST_COIN>(1_000_000, ts::ctx(&mut sc));
        treas::top_up_token<TEST_COIN>(&mut treasury, tokens);

        ts::next_tx(&mut sc, CREATOR);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        treas::withdraw_token<TEST_COIN>(&mut treasury, &owner_cap, 400_000, RECIPIENT_A, ts::ctx(&mut sc));

        assert!(treas::treasury_token_balance(&treasury) == 600_000, 0);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::ENotOwnerCap)]
    fun foreign_owner_cap_cannot_withdraw() {
        // Use the test-only TreasuryCapHolder helper to also fabricate a
        // foreign OwnerCap. Since OwnerCap has only `key + store` and is
        // constructed only inside agent_treasury, we use the public OwnerCap
        // from a SECOND launch in a separate scenario? No, OTW limits one
        // TEST_COIN per process. Instead we directly invoke withdraw_sui with
        // a freshly-minted owner cap that doesn't link to the treasury.
        //
        // The cleanest path: use a different agent (different scenario), but
        // OTW restrictions prevent a second TEST_COIN.
        //
        // Practical alternative: the foreign-cap test relies on a real second
        // agent. We cover the assertion structurally by mutating the cap's
        // linkage via a public test-only function. Since OwnerCap construction
        // is only inside the package, this test verifies the assertion fires
        // for the path that COULD be exercised: passing the wrong OwnerCap
        // among multiple, which v1 doesn't support multi-agent in one
        // scenario. Documented as structural coverage.
        //
        // For v1 we mark this with an expected_failure but in practice the
        // honest call path cannot trigger it within a single TEST_COIN scope.
        // The assertion remains a belt-and-suspenders for v1.1+ flows.
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        fund_treasury_sui(&mut sc, &mut treasury, 1_000_000_000);

        // Fabricate a foreign OwnerCap via the test-only constructor.
        ts::next_tx(&mut sc, ATTACKER);
        let foreign_cap = treas::test_only_make_owner_cap<TEST_COIN>(
            object::id_from_address(@0xFA1DE7),
            ts::ctx(&mut sc),
        );

        treas::withdraw_sui<TEST_COIN>(&mut treasury, &foreign_cap, 500_000_000, ATTACKER, ts::ctx(&mut sc));

        // Unreachable.
        sui::test_utils::destroy(foreign_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EInsufficientLiquidity)]
    fun withdraw_more_than_balance_aborts() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        fund_treasury_sui(&mut sc, &mut treasury, 1_000_000_000);

        ts::next_tx(&mut sc, CREATOR);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        treas::withdraw_sui<TEST_COIN>(&mut treasury, &owner_cap, 2_000_000_000, RECIPIENT_A, ts::ctx(&mut sc));

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ==========================================================
    //  Permissionless top-ups
    // ==========================================================

    #[test]
    fun anyone_can_top_up_sui() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        // Random sender funds the treasury.
        ts::next_tx(&mut sc, ATTACKER);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let payment = coin::mint_for_testing<SUI>(750_000_000, ts::ctx(&mut sc));
        treas::top_up_sui<TEST_COIN>(&mut treasury, payment);
        assert!(treas::treasury_sui_balance(&treasury) == 750_000_000, 0);

        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun anyone_can_top_up_token() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, ATTACKER);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let payment = coin::mint_for_testing<TEST_COIN>(1_500_000, ts::ctx(&mut sc));
        treas::top_up_token<TEST_COIN>(&mut treasury, payment);
        assert!(treas::treasury_token_balance(&treasury) == 1_500_000, 0);

        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ==========================================================
    //  OperatorCap lifecycle
    // ==========================================================

    #[test]
    fun owner_issues_operator_cap_post_launch() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);

        treas::issue_operator_cap<TEST_COIN>(
            &mut treasury, &owner_cap,
            OPERATOR,
            TEN_SUI_MIST,
            0,
            vector[RECIPIENT_A, RECIPIENT_B],
            THIRTY_DAYS_MS,
            &clock, ts::ctx(&mut sc),
        );

        assert!(treas::treasury_active_operator_cap_count(&treasury) == 1, 0);

        ts::next_tx(&mut sc, OPERATOR);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, OPERATOR);
        assert!(treas::operator_cap_daily_limit(&op_cap) == TEN_SUI_MIST, 1);
        assert!(treas::operator_cap_allowed_targets(&op_cap).length() == 2, 2);
        assert!(treas::operator_cap_expires_at_ms(&op_cap) > 0, 3);

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EOperatorTtlTooLong)]
    fun issue_operator_cap_aborts_when_ttl_exceeds_one_year() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);

        // MAX_OPERATOR_TTL_MS is 31_536_000_000 (1 year). +1 must abort.
        treas::issue_operator_cap<TEST_COIN>(
            &mut treasury, &owner_cap,
            OPERATOR, TEN_SUI_MIST, 0, vector[RECIPIENT_A],
            31_536_000_001,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun owner_revokes_operator_cap_removes_from_active_set() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_fresh(&mut sc);

        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);

        treas::issue_operator_cap<TEST_COIN>(
            &mut treasury, &owner_cap,
            OPERATOR, TEN_SUI_MIST, 0, vector[RECIPIENT_A], THIRTY_DAYS_MS,
            &clock, ts::ctx(&mut sc),
        );

        ts::next_tx(&mut sc, OPERATOR);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, OPERATOR);
        let cap_id = object::id(&op_cap);
        assert!(treas::treasury_has_operator_cap(&treasury, cap_id), 0);

        ts::next_tx(&mut sc, CREATOR);
        treas::revoke_operator_cap<TEST_COIN>(&mut treasury, &owner_cap, cap_id);
        assert!(treas::treasury_active_operator_cap_count(&treasury) == 0, 1);
        assert!(!treas::treasury_has_operator_cap(&treasury, cap_id), 2);

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ==========================================================
    //  operator_spend_sui — full policy enforcement
    // ==========================================================

    fun fixture_with_operator(sc: &mut Scenario): (Clock, AgentTreasury<TEST_COIN>, OwnerCap<TEST_COIN>, OperatorCap<TEST_COIN>) {
        let clock = launch_fresh(sc);
        ts::next_tx(sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(sc, CREATOR);

        // Issue operator cap.
        treas::issue_operator_cap<TEST_COIN>(
            &mut treasury, &owner_cap,
            OPERATOR, TEN_SUI_MIST, 0,
            vector[RECIPIENT_A, RECIPIENT_B],
            THIRTY_DAYS_MS,
            &clock, ts::ctx(sc),
        );

        // Fund treasury with 20 SUI.
        fund_treasury_sui(sc, &mut treasury, 20_000_000_000);

        ts::next_tx(sc, OPERATOR);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(sc, OPERATOR);

        (clock, treasury, owner_cap, op_cap)
    }

    #[test]
    fun operator_spends_within_scope_succeeds() {
        let mut sc = ts::begin(ADMIN);
        let (clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            3_000_000_000, RECIPIENT_A,
            &clock, ts::ctx(&mut sc),
        );

        assert!(treas::treasury_sui_balance(&treasury) == 17_000_000_000, 0);
        assert!(treas::operator_cap_spent_today(&op_cap) == 3_000_000_000, 1);

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EOperatorDailyLimitExceeded)]
    fun operator_spend_exceeding_daily_limit_aborts() {
        let mut sc = ts::begin(ADMIN);
        let (clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            TEN_SUI_MIST + 1, RECIPIENT_A,    // 1 MIST over the limit
            &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EOperatorTargetNotAllowed)]
    fun operator_spend_to_non_allowlisted_target_aborts() {
        let mut sc = ts::begin(ADMIN);
        let (clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            1_000_000_000, FORBIDDEN,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EOperatorCapExpired)]
    fun operator_spend_after_expiry_aborts() {
        let mut sc = ts::begin(ADMIN);
        let (mut clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        // Advance clock past TTL (30 days + 1 ms).
        clock::increment_for_testing(&mut clock, THIRTY_DAYS_MS + 1);

        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            1_000_000_000, RECIPIENT_A,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::agent_treasury::EOperatorCapRevoked)]
    fun operator_spend_after_revocation_aborts() {
        let mut sc = ts::begin(ADMIN);
        let (clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        // Revoke the cap.
        ts::next_tx(&mut sc, CREATOR);
        let cap_id = object::id(&op_cap);
        treas::revoke_operator_cap<TEST_COIN>(&mut treasury, &owner_cap, cap_id);

        // Operator tries to spend with revoked cap.
        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            1_000_000_000, RECIPIENT_A,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun operator_spend_resets_daily_budget_across_utc_day_boundary() {
        let mut sc = ts::begin(ADMIN);
        let (mut clock, mut treasury, owner_cap, mut op_cap) = fixture_with_operator(&mut sc);

        // Day 1: spend the entire daily limit.
        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            TEN_SUI_MIST, RECIPIENT_A,
            &clock, ts::ctx(&mut sc),
        );
        assert!(treas::operator_cap_spent_today(&op_cap) == TEN_SUI_MIST, 0);

        // Advance to next UTC day.
        clock::increment_for_testing(&mut clock, 86_400_000 + 1);

        // Day 2: should be able to spend the full limit again.
        ts::next_tx(&mut sc, OPERATOR);
        treas::operator_spend_sui<TEST_COIN>(
            &mut treasury, &mut op_cap,
            TEN_SUI_MIST, RECIPIENT_B,
            &clock, ts::ctx(&mut sc),
        );
        assert!(treas::operator_cap_spent_today(&op_cap) == TEN_SUI_MIST, 1);
        assert!(treas::treasury_sui_balance(&treasury) == 0, 2);

        ts::return_to_address(OPERATOR, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
