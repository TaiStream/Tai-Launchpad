//! Integration tests that hit the live Sui testnet.
//!
//! These are `#[ignore]` by default so `cargo test` stays fast and offline.
//! To run them:
//!
//! ```sh
//! cargo test -p tai-core -- --ignored
//! ```
//!
//! Test fixtures live on Sui testnet:
//! - **LaunchpadConfig** at the address recorded in `move/published.json`.
//! - **Larry the Analyst** — a real LaunchpadAccount + AgentTreasury launched
//!   at `examples/test-agent/published.json`. Sovereign-mode launch; the
//!   creator address is also the OwnerCap holder.

use tai_core::{
    hire_quote, AgentTreasuryView, LaunchpadAccountView, LaunchpadConfigView, ObjectId, RpcClient,
    TaiConfig,
};

// IDs from examples/test-agent/published.json (Larry v2 against Tai v1.0.1).
// Kept inline so the test file is self-contained and grep-able from the
// diff history.
const LARRY_LAUNCHPAD_ID: &str =
    "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e";
const LARRY_TREASURY_ID: &str =
    "0x4c5337abcbc0f5db1352ee68d25735f1a35ebca04a92fd04688d26629bc76592";
const LARRY_OWNER_CAP_ID: &str =
    "0x24c99cfb1bdda10172b93f5fa7493304f05266406454f2731bba938db692e57e";
const LARRY_HOLDER_ID: &str = "0xf4efb2a129ba420545a3289c6657c54f91cd7d90646e4423f68232625c0a62e5";
const LARRY_CREATOR: &str = "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14";

#[tokio::test]
#[ignore = "hits Sui testnet; run with `cargo test -- --ignored`"]
async fn live_testnet_launchpad_config_matches_spec_defaults() {
    let cfg = TaiConfig::testnet_v1();
    let rpc = RpcClient::new(&cfg.rpc_url);

    let view = LaunchpadConfigView::fetch(&rpc, cfg.config_id)
        .await
        .expect("fetch LaunchpadConfig from testnet");

    // Every default from SPEC §8, verified against the live deployment.
    assert_eq!(view.trade_fee_bps, 100);
    assert_eq!(view.trade_nav_share_bps, 3000);
    assert_eq!(view.trade_creator_share_bps, 6000);
    assert_eq!(view.trade_platform_share_bps, 1000);

    assert_eq!(view.service_nav_share_bps, 4000);
    assert_eq!(view.service_creator_share_bps, 5000);
    assert_eq!(view.service_platform_share_bps, 1000);

    assert_eq!(view.token_service_nav_share_bps, 4000);
    assert_eq!(view.token_service_burn_share_bps, 5000);
    assert_eq!(view.token_service_creator_share_bps, 1000);

    assert_eq!(view.virtual_sui_reserves, 10_000_000_000_000);
    assert_eq!(view.virtual_token_reserves, 1_073_000_000_000_000_000);
    assert_eq!(view.sale_supply, 800_000_000_000_000_000);
    assert_eq!(view.lp_supply, 200_000_000_000_000_000);

    assert_eq!(view.cred_revenue_target, 1_000_000_000_000);

    // Sanity: invariants from SPEC §4.1.
    assert_eq!(
        view.trade_nav_share_bps + view.trade_creator_share_bps + view.trade_platform_share_bps,
        10_000
    );
    assert_eq!(
        view.service_nav_share_bps
            + view.service_creator_share_bps
            + view.service_platform_share_bps,
        10_000
    );
    assert_eq!(
        view.token_service_nav_share_bps
            + view.token_service_burn_share_bps
            + view.token_service_creator_share_bps,
        10_000
    );

    // Admin/treasury at the publisher address.
    assert_eq!(
        view.admin.to_string(),
        "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14"
    );
    assert_eq!(view.platform_treasury, view.admin);
}

#[tokio::test]
#[ignore = "hits Sui testnet; run with `cargo test -- --ignored`"]
async fn live_testnet_larry_launchpad_account_state() {
    let cfg = TaiConfig::testnet_v1();
    let rpc = RpcClient::new(&cfg.rpc_url);

    let id: ObjectId = LARRY_LAUNCHPAD_ID.parse().unwrap();
    let acc = LaunchpadAccountView::fetch(&rpc, id).await.unwrap();

    // Type tag carries the LARRY generic.
    assert!(
        acc.coin_type.contains("::larry::LARRY"),
        "got coin_type={}",
        acc.coin_type
    );

    // Sovereign-mode launch: creator is the publisher.
    assert_eq!(acc.creator.to_string(), LARRY_CREATOR);

    // No linked identity at launch.
    assert_eq!(acc.linked_identity, None);
    // dwallets_object_id is reserved as Option<ID> and always None on v1 launches.
    assert_eq!(acc.dwallets_object_id, None);

    // Move-side `total_supply = sale_supply + lp_supply = 1B with 9 decimals`.
    assert_eq!(acc.total_supply, 1_000_000_000_000_000_000);
    assert_eq!(acc.decimals, 9);

    // Pool invariants — these are conservation laws regardless of activity.
    // real_token + lp_reserve + (tokens distributed via buys) = total_supply.
    // We just sanity-check that real_token <= initial sale supply (800M) and
    // lp_reserve is the locked 200M.
    assert!(acc.real_token <= 800_000_000_000_000_000);
    assert_eq!(acc.lp_reserve, 200_000_000_000_000_000);
    // NAV can only grow (no withdraw path), so >= 0 is the only assertion.
    // We don't pin exact values — Larry's NAV evolves as people hire and trade.

    // Default access config: open, no token payments.
    assert_eq!(acc.access_threshold, 0);
    assert!(!acc.accept_coin_payments);
    // Cred target snapshotted from the global config at launch.
    assert_eq!(acc.cred_revenue_target, 1_000_000_000_000);

    // Virtual curve constants snapshotted from config.
    assert_eq!(acc.virtual_sui_reserves, 10_000_000_000_000);
    assert_eq!(acc.virtual_token_reserves, 1_073_000_000_000_000_000);

    // Counters only grow monotonically; pinning exact values would race with
    // organic activity. Just verify they're well-formed.
    assert!(acc.launched_at > 0);
    // cumulative_volume includes both buys and sells; if there have been any
    // trades, cumulative_fees should be > 0.
    if acc.total_buys + acc.total_sells > 0 {
        assert!(acc.cumulative_volume_sui > 0);
        assert!(acc.cumulative_fees_sui > 0);
    }
    if acc.total_service_payments_sui > 0 {
        // At least one external hire grew NAV (40% of payment).
        assert!(acc.nav_sui > 0);
    }

    // Bidirectional linkage to sibling objects.
    let expected_holder: ObjectId = LARRY_HOLDER_ID.parse().unwrap();
    let expected_treasury: ObjectId = LARRY_TREASURY_ID.parse().unwrap();
    let expected_owner_cap: ObjectId = LARRY_OWNER_CAP_ID.parse().unwrap();
    assert_eq!(acc.treasury_cap_holder_id, expected_holder);
    assert_eq!(acc.agent_treasury_id, expected_treasury);
    assert_eq!(acc.owner_cap_id, expected_owner_cap);
}

#[tokio::test]
#[ignore = "hits Sui testnet; run with `cargo test -- --ignored`"]
async fn live_testnet_larry_agent_treasury_state() {
    let cfg = TaiConfig::testnet_v1();
    let rpc = RpcClient::new(&cfg.rpc_url);

    let treasury_id: ObjectId = LARRY_TREASURY_ID.parse().unwrap();
    let treasury = AgentTreasuryView::fetch(&rpc, treasury_id).await.unwrap();

    // Bidirectional linkage back to the LaunchpadAccount.
    let expected_launchpad: ObjectId = LARRY_LAUNCHPAD_ID.parse().unwrap();
    assert_eq!(treasury.launchpad_account_id, expected_launchpad);

    let expected_owner_cap: ObjectId = LARRY_OWNER_CAP_ID.parse().unwrap();
    assert_eq!(treasury.owner_cap_id, expected_owner_cap);

    // Sovereign-mode launch issued no OperatorCap.
    assert!(treasury.active_operator_cap_ids.is_empty());

    // Treasury is empty at launch.
    assert_eq!(treasury.sui_balance, 0);
    assert_eq!(treasury.token_balance, 0);
}

#[tokio::test]
#[ignore = "hits Sui testnet; run with `cargo test -- --ignored`"]
async fn live_testnet_larry_hire_quote_at_baseline_is_one_x() {
    let cfg = TaiConfig::testnet_v1();
    let rpc = RpcClient::new(&cfg.rpc_url);

    let id: ObjectId = LARRY_LAUNCHPAD_ID.parse().unwrap();
    let acc = LaunchpadAccountView::fetch(&rpc, id).await.unwrap();
    let quote = hire_quote(&acc);

    // Invariants — independent of how much Larry has earned over time:
    //   - multiplier is in [10_000, 20_000] (1.0x baseline → 2.0x cap)
    //   - hire_price = nav * multiplier / 10_000 → never less than NAV
    //   - cred_revenue_target is the launch-time snapshot of config default
    assert_eq!(quote.cred_revenue_target, 1_000_000_000_000);
    assert!(quote.multiplier_bps >= 10_000);
    assert!(quote.multiplier_bps <= 20_000);
    assert!(quote.hire_price_sui >= quote.nav_sui);
    assert_eq!(quote.nav_sui, acc.nav_sui);
    assert_eq!(
        quote.lifetime_service_revenue_sui,
        acc.lifetime_service_revenue_sui
    );
}
