/// Test agent coin module used to launch a real LaunchpadAccount on
/// Sui testnet for tai-core's live write integration tests.
///
/// LARRY is a one-time-witness type. At publish time the module's init
/// function creates the coin, shares the CoinMetadata (so launch_agent_coin
/// can borrow it), and transfers the TreasuryCap to the publisher so the
/// follow-up tai::launchpad::launch_agent_coin call can consume it.
module test_agent::larry {
    use sui::coin;

    public struct LARRY has drop {}

    #[allow(deprecated_usage)]
    fun init(witness: LARRY, ctx: &mut TxContext) {
        let (cap, metadata) = coin::create_currency<LARRY>(
            witness,
            9,
            b"LARRY",
            b"Larry the Analyst",
            b"Test agent for Tai v1 live write integration testing.",
            option::none(),
            ctx,
        );
        transfer::public_share_object(metadata);
        transfer::public_transfer(cap, ctx.sender());
    }
}
