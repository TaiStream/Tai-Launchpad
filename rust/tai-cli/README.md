# tai

`tai` — the command-line interface to the [Tai launchpad](https://github.com/TaiStream/Tai-Launchpad), the Sui-native agent-economy protocol.

Launch an agent, hire it, trade its bonding-curve coin, settle escrow work orders — all from your shell.

## Install

```sh
cargo install tai-cli
```

`tai` also requires the [`sui` CLI](https://docs.sui.io/references/cli/client) on PATH (used by `tai launch` to publish freshly-generated coin modules).

## First run

```sh
# 1. Initialize config + generate a fresh Ed25519 keypair.
tai init --generate-key

# 2. Print the new address (also shown by `init`).
tai status

# 3. Fund it from the Sui testnet faucet.
#    Visit https://faucet.testnet.sui.io and paste the address, or:
curl -X POST https://faucet.testnet.sui.io/v2/gas \
  -H 'Content-Type: application/json' \
  -d "{\"FixedAmountRequest\":{\"recipient\":\"$(tai status --output json | jq -r .signer_address)\"}}"

# 4. Launch your first agent.
tai launch --symbol DEMO --name "My Demo Agent" --decimals 9

# 5. View it in the dashboard.
open https://tai-app-lyart.vercel.app/agents
```

## Common flows

| Goal | Command |
|---|---|
| **Launch** an agent (single shell call) | `tai launch --symbol X --name "..."` |
| **Buy** an agent's coin from the curve | `tai buy --launchpad <ID> --coin-type <T> --payment-coin <ID>` |
| **Sell** an agent's coin back to the curve | `tai sell --launchpad <ID> --coin-type <T> --tokens-coin <ID>` |
| **Hire** an agent (direct, no escrow) | `tai pay sui --launchpad <ID> --coin-type <T> --payment-coin <ID>` |
| **Hire** with escrow (`WorkOrder<T>`) | `tai hire --agent <ID> --coin-type <T> --payment-coin <ID> --deadline-ms <EPOCH_MS>` |
| **Accept** an escrow as payee | `tai work accept --id <ORDER_ID> --coin-type <T> --owner-cap <CAP_ID>` |
| **Submit a receipt** | `tai work submit-receipt --id <ORDER_ID> --coin-type <T> --owner-cap <CAP_ID> --receipt-url <URL>` |
| **Release** as buyer | `tai work release --id <ORDER_ID> --coin-type <T> --payee-account <ID>` |
| **Dispute** as buyer | `tai work dispute --id <ORDER_ID> --coin-type <T>` |
| **Refund** as buyer (after deadline) | `tai work refund --id <ORDER_ID> --coin-type <T>` |
| **Read** an agent | `tai account show --launchpad <ID>` |
| **Read** the live hire quote | `tai quote --launchpad <ID>` |

Every command supports `--output json` (default when piped) or `--output pretty`. JSON output is grep/jq-friendly.

## What `tai launch` does

In one shell call:

1. Generates a fresh Move coin module from a template — module name + OTW witness are randomized so each launch is globally unique.
2. Shells out to `sui client publish` to compile + publish the coin module on Sui.
3. Parses the publish JSON to extract the freshly-minted `TreasuryCap<T>` and `CoinMetadata<T>` ids.
4. Calls `tai::launchpad::launch_agent_coin<T>` from your tai-cli signer, which consumes the cap and atomically creates the `LaunchpadAccount<T>`, `AgentTreasury<T>`, `OwnerCap<T>`, `TreasuryCapHolder<T>`, and (optionally) `OperatorCap<T>` in a single PTB.
5. Returns all object ids as JSON.

## Custody modes (emergent — same primitives, different cap recipients at launch)

| Mode | OwnerCap recipient | OperatorCap recipient | Flag pattern |
|---|---|---|---|
| **Sovereign** — agent owns itself | tai-cli signer | tai-cli signer | (defaults) |
| **Commissioned** — human owns, agent operates | human address | agent runtime address | `--owner-cap-recipient 0x... --operator-recipient 0x...` |
| **Spawned** — parent owns sub-agent | parent's OwnerCap holder | sub-agent runtime | manual flags |

## Configuration

`~/.tai/config.toml` after `tai init`:

```toml
network = "testnet"

[signer]
mode = "ed25519"
key_path = "/Users/you/.tai/keys/default.key"
```

Key files are written `0600` (owner read/write only). `tai` warns if the file permissions are looser than that on load.

## Where to get help

- **GitHub:** <https://github.com/TaiStream/Tai-Launchpad>
- **Dashboard:** <https://tai-app-lyart.vercel.app>
- **Larry the Analyst** (live reference agent + Tai ecosystem updates Telegram channel @TaiUpdates)
- **SPEC** (architecture): [`SPEC.md`](https://github.com/TaiStream/Tai-Launchpad/blob/main/SPEC.md) in the repo

## Release process (for maintainers)

Releases are cut via GitHub Actions; there's no `cargo publish` from a laptop.

1. Bump the workspace version in `rust/Cargo.toml`:
   ```toml
   [workspace.package]
   version = "0.2.0"   # for example
   ```
2. Commit and push to `main`.
3. Tag and push:
   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The `.github/workflows/publish.yml` workflow fires, verifies the tag matches the workspace version, runs build+test, publishes `tai-core` then `tai-cli` to crates.io (60 s wait between them for index sync), then creates a GitHub Release.

For the **first publish** (or any time you want to dry-run), use the manual workflow_dispatch trigger from the Actions tab — toggle the `dry_run` input to validate the flow without uploading anything.

### Required GitHub secret

- `CARGO_REGISTRY_TOKEN` — your crates.io API token. Create one at <https://crates.io/me/tokens>, scope it to `publish-new` + `publish-update` for both crates, and add it as a repository secret.

## License

MIT.
