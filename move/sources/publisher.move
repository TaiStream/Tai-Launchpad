/// Module: publisher
///
/// One-time-witness module whose only job is to claim a `Publisher`
/// capability for the `tai` package. Added in the v1.0.1 upgrade so the
/// admin can register `sui::display::Display<T>` for any type defined in
/// this package — specifically `Display<OwnerCap<T>>` per agent, which
/// makes the OwnerCap render as a rich card in wallets.
///
/// Sui semantics:
/// - `init` of a NEWLY ADDED module runs as part of the upgrade tx.
/// - The OTW (`PUBLISHER`) is consumed by `package::claim` to produce the
///   `Publisher` object, which is then transferred to the upgrade sender
///   (the package admin).
///
/// No public functions, no shared state. Just the init.
module tai::publisher {
    use sui::package;

    /// One-time-witness type for this module. The Sui Move convention
    /// requires the OTW name to be the module name uppercased.
    public struct PUBLISHER has drop {}

    #[allow(lint(self_transfer))]
    fun init(otw: PUBLISHER, ctx: &mut TxContext) {
        let publisher = package::claim(otw, ctx);
        transfer::public_transfer(publisher, ctx.sender());
    }
}
