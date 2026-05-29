#[test_only]
module tai::work_order_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::transfer;
    use tai::launchpad::{Self as lp, LaunchpadConfig, LaunchpadAccount};
    use tai::agent_treasury::{Self as treas, OwnerCap, OperatorCap, AgentTreasury};
    use tai::test_coin::{Self as tc, TEST_COIN};
    use tai::work_order::{Self as wo, WorkOrder};

    const ADMIN: address = @0xAD;
    const CREATOR: address = @0xC1;
    const PAYEE_RUNTIME: address = @0xA61;
    const BUYER: address = @0xBA1;
    const OUTSIDER: address = @0x0001;

    const ONE_SUI_MIST: u64 = 1_000_000_000;
    const FIVE_SUI_MIST: u64 = 5_000_000_000;

    const ONE_DAY_MS: u64 = 86_400_000;
    const ONE_HOUR_MS: u64 = 3_600_000;
    const SHORT_DISPUTE_MS: u64 = 300_000;         // 5 minutes (== protocol minimum)

    // ===================================================================
    //  Fixtures
    // ===================================================================

    /// Launch a sovereign-mode agent (CREATOR holds OwnerCap; no OperatorCap).
    fun launch_solo(sc: &mut Scenario): Clock {
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

    /// Launch with both an OwnerCap (CREATOR) and a long-TTL OperatorCap
    /// (PAYEE_RUNTIME). Used to exercise the operator-cap acceptance path.
    fun launch_with_operator(sc: &mut Scenario): Clock {
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
            option::some(PAYEE_RUNTIME),
            ONE_SUI_MIST,                    // 1 SUI daily limit
            0,                                // 0 token daily limit
            vector[OUTSIDER],                 // dummy allowlist
            30 * ONE_DAY_MS,                  // 30-day TTL
            &clock, ts::ctx(sc),
        );
        ts::return_shared(config);
        transfer::public_share_object(metadata);
        clock
    }

    fun mint_sui(sc: &mut Scenario, amount: u64): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, ts::ctx(sc))
    }

    fun create_basic_order(
        sc: &mut Scenario,
        clock: &mut Clock,
        amount: u64,
        deadline_ms: u64,
        dispute_window_ms: u64,
    ) {
        ts::next_tx(sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(sc);
        let payment = mint_sui(sc, amount);
        wo::create_work_order<TEST_COIN>(
            &account,
            payment,
            b"deadbeef",                     // spec_hash
            std::string::utf8(b"https://example.com/spec"),
            deadline_ms,
            dispute_window_ms,
            clock,
            ts::ctx(sc),
        );
        ts::return_shared(account);
    }

    // ===================================================================
    //  Lifecycle: happy path (owner-cap variant)
    // ===================================================================

    #[test]
    fun owner_accepts_submits_buyer_releases_routes_through_service_payment() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        // OwnerCap accepts.
        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner<TEST_COIN>(&mut order, &owner_cap, &clock);
        assert!(wo::work_order_status(&order) == wo::status_accepted(), 0);

        // OwnerCap submits receipt.
        wo::submit_receipt_with_owner<TEST_COIN>(
            &mut order, &owner_cap,
            b"feedbeef",
            std::string::utf8(b"ipfs://result"),
            &clock,
        );
        assert!(wo::work_order_status(&order) == wo::status_receipt_submitted(), 1);

        // Buyer releases.
        ts::next_tx(&mut sc, BUYER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        wo::release_work_order<TEST_COIN>(
            &mut order, &config, &mut account, &clock, ts::ctx(&mut sc),
        );
        assert!(wo::work_order_status(&order) == wo::status_released(), 2);

        // NAV grew (10% of 1 SUI = 0.1 SUI under default 40/50/10 service split…
        // wait: actually service-SUI split defaults are 40/50/10 NAV/creator/platform
        // and 1 SUI = 1_000_000_000 MIST → NAV = 400_000_000 MIST.
        assert!(lp::account_nav_sui(&account) == 400_000_000, 3);
        // Lifetime revenue updated (full 1 SUI counts; payer != creator).
        assert!(lp::account_lifetime_service_revenue(&account) == ONE_SUI_MIST, 4);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Lifecycle: operator-cap acceptance path
    // ===================================================================

    #[test]
    fun operator_cap_can_accept_and_submit_receipt() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_with_operator(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, PAYEE_RUNTIME);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, PAYEE_RUNTIME);
        wo::accept_work_order_with_operator<TEST_COIN>(&mut order, &op_cap, &clock);
        wo::submit_receipt_with_operator<TEST_COIN>(
            &mut order, &op_cap,
            b"ok",
            std::string::utf8(b""),
            &clock,
        );
        assert!(wo::work_order_status(&order) == wo::status_receipt_submitted(), 0);

        ts::return_to_address(PAYEE_RUNTIME, op_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Lifecycle: anyone can finalize after dispute window
    // ===================================================================

    #[test]
    fun anyone_can_finalize_after_dispute_window_elapses() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(
            &mut order, &owner_cap,
            b"r", std::string::utf8(b""), &clock,
        );

        // Advance past the dispute window.
        clock::increment_for_testing(&mut clock, SHORT_DISPUTE_MS + 1);

        // A third party finalizes.
        ts::next_tx(&mut sc, OUTSIDER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        wo::release_work_order(&mut order, &config, &mut account, &clock, ts::ctx(&mut sc));
        assert!(wo::work_order_status(&order) == wo::status_released(), 0);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EReceiptWindowNotExpired)]
    fun non_buyer_cannot_finalize_before_dispute_window_elapses() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(
            &mut order, &owner_cap,
            b"r", std::string::utf8(b""), &clock,
        );

        ts::next_tx(&mut sc, OUTSIDER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        // Window has not expired — must abort.
        wo::release_work_order(&mut order, &config, &mut account, &clock, ts::ctx(&mut sc));

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Refund paths
    // ===================================================================

    #[test]
    fun buyer_refunds_after_deadline_no_acceptance() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_HOUR_MS, SHORT_DISPUTE_MS);

        // No accept; advance past the deadline.
        clock::increment_for_testing(&mut clock, ONE_HOUR_MS + 1);

        ts::next_tx(&mut sc, BUYER);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        wo::refund_work_order(&mut order, &clock, ts::ctx(&mut sc));
        assert!(wo::work_order_status(&order) == wo::status_refunded(), 0);

        // BUYER got the SUI back.
        ts::next_tx(&mut sc, BUYER);
        let refund = ts::take_from_address<Coin<SUI>>(&sc, BUYER);
        assert!(coin::value(&refund) == ONE_SUI_MIST, 1);
        ts::return_to_address(BUYER, refund);

        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun buyer_refunds_after_deadline_accepted_but_no_receipt() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_HOUR_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);

        // Advance past deadline without a receipt.
        clock::increment_for_testing(&mut clock, ONE_HOUR_MS + 1);

        ts::next_tx(&mut sc, BUYER);
        wo::refund_work_order(&mut order, &clock, ts::ctx(&mut sc));
        assert!(wo::work_order_status(&order) == wo::status_refunded(), 0);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EDeadlineNotReached)]
    fun buyer_cannot_refund_before_deadline() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, BUYER);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        wo::refund_work_order(&mut order, &clock, ts::ctx(&mut sc));
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EWrongStatus)]
    fun buyer_cannot_refund_after_receipt_submitted() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_HOUR_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(&mut order, &owner_cap, b"r", std::string::utf8(b""), &clock);

        // Advance past deadline. But receipt was submitted — refund must abort.
        clock::increment_for_testing(&mut clock, ONE_DAY_MS);
        ts::next_tx(&mut sc, BUYER);
        wo::refund_work_order(&mut order, &clock, ts::ctx(&mut sc));

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::ENotBuyer)]
    fun non_buyer_cannot_refund() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_HOUR_MS, SHORT_DISPUTE_MS);
        clock::increment_for_testing(&mut clock, ONE_HOUR_MS + 1);

        ts::next_tx(&mut sc, OUTSIDER);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        wo::refund_work_order(&mut order, &clock, ts::ctx(&mut sc));
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Foreign-cap rejection
    // ===================================================================

    #[test]
    #[expected_failure(abort_code = tai::work_order::ENotPayeeCap)]
    fun foreign_owner_cap_cannot_accept() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        // Fabricate a foreign OwnerCap with an unrelated treasury id.
        ts::next_tx(&mut sc, OUTSIDER);
        let foreign_cap = treas::test_only_make_owner_cap<TEST_COIN>(
            object::id_from_address(@0xFA1DE7),
            ts::ctx(&mut sc),
        );

        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        wo::accept_work_order_with_owner<TEST_COIN>(&mut order, &foreign_cap, &clock);

        sui::test_utils::destroy(foreign_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Dispute paths
    // ===================================================================

    #[test]
    fun buyer_opens_dispute_admin_resolves_to_payee() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(&mut order, &owner_cap, b"r", std::string::utf8(b""), &clock);

        ts::next_tx(&mut sc, BUYER);
        wo::open_dispute(&mut order, &clock, ts::ctx(&mut sc));
        assert!(wo::work_order_status(&order) == wo::status_disputed(), 0);

        // Admin resolves in favor of payee.
        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        wo::admin_resolve_dispute(
            &mut order, &config, &mut account,
            true,   // in favor of payee
            &clock, ts::ctx(&mut sc),
        );
        assert!(wo::work_order_status(&order) == wo::status_released(), 1);
        assert!(lp::account_nav_sui(&account) == 400_000_000, 2);

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun buyer_opens_dispute_admin_resolves_to_buyer() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(&mut order, &owner_cap, b"r", std::string::utf8(b""), &clock);

        ts::next_tx(&mut sc, BUYER);
        wo::open_dispute(&mut order, &clock, ts::ctx(&mut sc));

        ts::next_tx(&mut sc, ADMIN);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        wo::admin_resolve_dispute(
            &mut order, &config, &mut account,
            false,  // refund
            &clock, ts::ctx(&mut sc),
        );
        assert!(wo::work_order_status(&order) == wo::status_refunded(), 0);
        assert!(lp::account_nav_sui(&account) == 0, 1);

        ts::next_tx(&mut sc, BUYER);
        let refund = ts::take_from_address<Coin<SUI>>(&sc, BUYER);
        assert!(coin::value(&refund) == ONE_SUI_MIST, 2);

        ts::return_to_address(BUYER, refund);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EReceiptWindowExpired)]
    fun cannot_dispute_after_window_expires() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(&mut order, &owner_cap, b"r", std::string::utf8(b""), &clock);

        clock::increment_for_testing(&mut clock, SHORT_DISPUTE_MS + 1);

        ts::next_tx(&mut sc, BUYER);
        wo::open_dispute(&mut order, &clock, ts::ctx(&mut sc));

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::ENotAdmin)]
    fun non_admin_cannot_resolve_dispute() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);
        wo::submit_receipt_with_owner(&mut order, &owner_cap, b"r", std::string::utf8(b""), &clock);

        ts::next_tx(&mut sc, BUYER);
        wo::open_dispute(&mut order, &clock, ts::ctx(&mut sc));

        // OUTSIDER, not admin, tries to resolve.
        ts::next_tx(&mut sc, OUTSIDER);
        let config = ts::take_shared<LaunchpadConfig>(&sc);
        let mut account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        wo::admin_resolve_dispute(
            &mut order, &config, &mut account,
            true, &clock, ts::ctx(&mut sc),
        );

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(account);
        ts::return_shared(config);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    // ===================================================================
    //  Creation guards
    // ===================================================================

    #[test]
    #[expected_failure(abort_code = tai::work_order::EAmountTooSmall)]
    fun cannot_create_order_below_minimum_amount() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_solo(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let dust = mint_sui(&mut sc, 999); // below 1_000 minimum
        wo::create_work_order<TEST_COIN>(
            &account, dust,
            b"x", std::string::utf8(b""),
            ONE_HOUR_MS,
            SHORT_DISPUTE_MS,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EDeadlineInPast)]
    fun cannot_create_order_with_past_deadline() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);
        clock::increment_for_testing(&mut clock, ONE_DAY_MS);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let payment = mint_sui(&mut sc, ONE_SUI_MIST);
        wo::create_work_order<TEST_COIN>(
            &account, payment,
            b"x", std::string::utf8(b""),
            ONE_HOUR_MS,    // deadline less than now → must abort
            SHORT_DISPUTE_MS,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EDisputeWindowTooLong)]
    fun cannot_create_order_with_excessive_dispute_window() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_solo(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let payment = mint_sui(&mut sc, ONE_SUI_MIST);
        wo::create_work_order<TEST_COIN>(
            &account, payment,
            b"x", std::string::utf8(b""),
            ONE_DAY_MS,
            30 * ONE_DAY_MS + 1, // > 30-day cap
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EHashTooLong)]
    fun cannot_create_order_with_oversized_spec_hash() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_solo(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let payment = mint_sui(&mut sc, ONE_SUI_MIST);
        // 129 bytes — one over the 128 cap.
        let mut big_hash = vector::empty<u8>();
        let mut i = 0;
        while (i < 129) { big_hash.push_back(7u8); i = i + 1; };
        wo::create_work_order<TEST_COIN>(
            &account, payment,
            big_hash, std::string::utf8(b""),
            ONE_DAY_MS, SHORT_DISPUTE_MS,
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun create_order_with_max_spec_hash_succeeds() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let payment = mint_sui(&mut sc, ONE_SUI_MIST);
        // Exactly 128 bytes — at the cap, must succeed.
        let mut max_hash = vector::empty<u8>();
        let mut i = 0;
        while (i < 128) { max_hash.push_back(7u8); i = i + 1; };
        wo::create_work_order<TEST_COIN>(
            &account, payment,
            max_hash, std::string::utf8(b"https://example.com/spec"),
            ONE_DAY_MS, SHORT_DISPUTE_MS,
            &clock, ts::ctx(&mut sc),
        );

        ts::next_tx(&mut sc, BUYER);
        let order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        assert!(wo::work_order_spec_hash(&order).length() == 128, 0);
        ts::return_shared(order);

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EHashTooLong)]
    fun cannot_submit_receipt_with_oversized_hash() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_solo(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, CREATOR);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        wo::accept_work_order_with_owner(&mut order, &owner_cap, &clock);

        let mut big = vector::empty<u8>();
        let mut i = 0;
        while (i < 129) { big.push_back(1u8); i = i + 1; };
        wo::submit_receipt_with_owner(
            &mut order, &owner_cap, big, std::string::utf8(b""), &clock,
        );

        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = tai::work_order::EDisputeWindowTooShort)]
    fun cannot_create_order_with_dispute_window_below_minimum() {
        let mut sc = ts::begin(ADMIN);
        let clock = launch_solo(&mut sc);

        ts::next_tx(&mut sc, BUYER);
        let account = ts::take_shared<LaunchpadAccount<TEST_COIN>>(&sc);
        let payment = mint_sui(&mut sc, ONE_SUI_MIST);
        wo::create_work_order<TEST_COIN>(
            &account, payment,
            b"x", std::string::utf8(b""),
            ONE_DAY_MS,
            wo::min_dispute_window_ms() - 1, // one ms under the floor
            &clock, ts::ctx(&mut sc),
        );

        ts::return_shared(account);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    fun operator_v2_can_accept_and_submit_receipt() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_with_operator(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        ts::next_tx(&mut sc, PAYEE_RUNTIME);
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        let treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, PAYEE_RUNTIME);
        wo::accept_work_order_with_operator_v2<TEST_COIN>(
            &mut order, &op_cap, &treasury, &clock,
        );
        wo::submit_receipt_with_operator_v2<TEST_COIN>(
            &mut order, &op_cap, &treasury,
            b"ok", std::string::utf8(b""), &clock,
        );
        assert!(wo::work_order_status(&order) == wo::status_receipt_submitted(), 0);

        ts::return_to_address(PAYEE_RUNTIME, op_cap);
        ts::return_shared(treasury);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(
        abort_code = tai::agent_treasury::EOperatorCapRevoked,
        location = tai::work_order,
    )]
    fun revoked_operator_cap_cannot_accept_v2() {
        let mut sc = ts::begin(ADMIN);
        let mut clock = launch_with_operator(&mut sc);

        create_basic_order(&mut sc, &mut clock, ONE_SUI_MIST, ONE_DAY_MS, SHORT_DISPUTE_MS);

        // Owner revokes the operator cap.
        ts::next_tx(&mut sc, CREATOR);
        let mut treasury = ts::take_shared<AgentTreasury<TEST_COIN>>(&sc);
        let owner_cap = ts::take_from_address<OwnerCap<TEST_COIN>>(&sc, CREATOR);
        let op_cap = ts::take_from_address<OperatorCap<TEST_COIN>>(&sc, PAYEE_RUNTIME);
        treas::revoke_operator_cap(&mut treasury, &owner_cap, object::id(&op_cap));

        // The revoked operator tries to accept via v2 → aborts.
        let mut order = ts::take_shared<WorkOrder<TEST_COIN>>(&sc);
        wo::accept_work_order_with_operator_v2<TEST_COIN>(
            &mut order, &op_cap, &treasury, &clock,
        );

        ts::return_to_address(PAYEE_RUNTIME, op_cap);
        ts::return_to_address(CREATOR, owner_cap);
        ts::return_shared(treasury);
        ts::return_shared(order);
        clock::destroy_for_testing(clock);
        ts::end(sc);
    }
}
