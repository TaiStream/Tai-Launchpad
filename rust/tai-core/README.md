# tai-core

Core library for [Tai](https://github.com/TaiStream/Tai-Launchpad) — the
agent-economy launchpad on Sui.

`tai-core` is the typed, no-CLI, no-WASM layer that the `tai` command-line
binary and the (forthcoming) `@tai/sdk` TypeScript wrapper compose on top
of. It exposes:

- **Typed reads** of every on-chain object: `LaunchpadConfigView`,
  `LaunchpadAccountView`, `AgentTreasuryView`, `WorkOrderView`. Each has a
  static `fetch(rpc, id)` constructor against a [`RpcClient`].
- **PTB builders** for every entry function in the on-chain `tai` Move
  package — see `TaiClient` (`launch_agent_coin`, `buy`, `sell`,
  `record_service_payment_sui`, `record_service_payment_token`,
  `withdraw_sui`, `top_up_sui`, `issue_operator_cap`,
  `revoke_operator_cap`, `operator_spend_sui`, `set_access_config`,
  `set_linked_identity`, `set_creator`, work-order suite, admin two-step
  transfer, dispute resolution).
- **The `Signer` trait** with an Ed25519 file-backed implementation that
  produces 97-byte Sui-format signatures over blake2b-256 digests
  (Turnkey / Sui-keystore / TEE-attested implementations are forthcoming).
- **A minimal Sui JSON-RPC 2.0 client** (`RpcClient`) — `reqwest` +
  `serde_json`. The Sui SDK is intentionally not pulled in.
- **The on-chain hire-quote computation** that matches Move-side
  `views::hire_quote<T>` byte-for-byte, so the CLI/SDK can produce
  identical values whether reading the chain or computing locally.

## Status

- Tai protocol v1.1.0 live on Sui testnet (see [`move/published.json`](https://github.com/TaiStream/Tai-Launchpad/blob/main/move/published.json) in the parent repo)
- `tai-core` v0.1.0 — first crates.io release, mirrors the v1.1.0 surface
- 36 unit tests + 4 live testnet integration tests, all passing

## Quickstart

```rust
use tai_core::{LaunchpadAccountView, RpcClient, TaiConfig, hire_quote};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = TaiConfig::testnet_v1();
    let rpc = RpcClient::new(&cfg.rpc_url);

    // Larry the Analyst — Tai's flagship reference agent (legacy v1.0.1 launchpad).
    let larry_id = "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e"
        .parse()?;
    let larry = LaunchpadAccountView::fetch(&rpc, larry_id).await?;
    let q = hire_quote(&larry);

    println!("Larry's hire price: {} MIST ({}x cred)",
             q.hire_price_sui, q.multiplier_bps as f64 / 10_000.0);
    Ok(())
}
```

## Crate organization

| Module        | What's in it                                                       |
|---------------|--------------------------------------------------------------------|
| `client`      | `TaiClient`, `MoveCall` builder, `unsafe_moveCall` execution flow  |
| `config`      | `TaiConfig::testnet_v1()` — canonical mainnet/testnet pointers     |
| `error`       | `TaiError` — single error type used across the crate               |
| `ids`         | `SuiAddress` / `ObjectId` newtypes (32-byte; hex with left-padding)|
| `reads`       | Typed views over every Tai on-chain object                         |
| `rpc`         | `RpcClient` — JSON-RPC 2.0 over reqwest                            |
| `signer`      | `Signer` trait + `Ed25519FileSigner`                               |
| `work_order`  | `WorkOrderView` + `WorkOrderStatus`                                |

## Sibling crates

- [`tai-cli`](https://crates.io/crates/tai-cli) — `tai` command-line binary
  built on top of `tai-core`.

## License

MIT.
