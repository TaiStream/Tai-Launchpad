//! Integration tests that hit the live Sui testnet.
//!
//! These are `#[ignore]` by default so `cargo test` stays fast and offline.
//! To run them:
//!
//! ```sh
//! cargo test -p tai-core -- --ignored
//! ```

use tai_core::{LaunchpadConfigView, RpcClient, TaiConfig};

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
        view.trade_nav_share_bps
            + view.trade_creator_share_bps
            + view.trade_platform_share_bps,
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
