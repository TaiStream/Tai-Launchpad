#[test_only]
module tai::test_coin {
    use sui::coin;

    /// One-time-witness type for the test coin.
    /// Used inside the same test scenario via `create_for_testing`; in
    /// production each agent's coin module would supply its own OTW.
    public struct TEST_COIN has drop {}

    #[allow(deprecated_usage)]
    public fun create_for_testing(ctx: &mut TxContext): (
        sui::coin::TreasuryCap<TEST_COIN>,
        sui::coin::CoinMetadata<TEST_COIN>,
    ) {
        coin::create_currency(
            TEST_COIN {},
            9,
            b"TEST",
            b"Test Agent Coin",
            b"Test coin for launchpad tests",
            option::none(),
            ctx,
        )
    }
}
