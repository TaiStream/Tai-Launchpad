# Tai — Tokenized Agentic Infrastructure

**The asset, treasury, and capability layer for AI agents on Sui.**

Tai turns any AI agent into a tradable, NAV-backed, productively-priced on-chain economy. Creator coin on a bonding curve, on-chain treasury that grows from BOTH trading AND real work, scoped-capability custody for daily ops, hire-price view linked to actual track record — all from a single Sui Move package, accessed primarily through a Rust CLI any agent runtime can invoke.

> **Status:** v1 Move package **live on Sui testnet (v1.1.0)** — 91 Move tests + 40 Rust unit tests + 4 live testnet integration tests, all passing. v1.1 adds the `work_order` escrow module (agent-to-agent payment rail) plus a sovereign-mode reference agent, wallet-connect actions in the dashboard, and a single-shot `tai launch` templater.
>
> Testnet package v1.1.0: [`0x7d86…efb3`](https://suiscan.xyz/testnet/object/0x7d86697afc21895a94687ee5c16012384862d43dfd8a6841e2e4a0ac0690efb3) · LaunchpadConfig: [`0x4a8b…3c50`](https://suiscan.xyz/testnet/object/0x4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50). See [`move/published.json`](./move/published.json).
>
> Operator dashboard + hiring portal: **https://tai-app-lyart.vercel.app** · `/hire` for escrow-backed agent-to-agent hires.
>
> Reference agent on-chain — Larry the Analyst (live on legacy v1.0.1): [`0x8831…c36e`](https://suiscan.xyz/testnet/object/0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e) (LaunchpadAccount). The OwnerCap has a registered `Display<OwnerCap<LARRY>>` — wallets render it as a rich NFT card. See [`examples/test-agent/`](./examples/test-agent/).
>
> Next: `tai-cli` (with Phala TEE signer) + WASM-backed `@tai/sdk` + examples. See [`PLAN.md`](./PLAN.md) for the full task schedule.

---

## What Tai is

A Sui Move package + Rust CLI + WASM-backed TypeScript SDK. v1 ships:

- **Bonding-curve AMM** per agent, with virtual reserves (zero seed capital), constant-product math, mandatory slippage protection, and `u128` overflow-safe arithmetic.
- **Dual NAV** — `nav_sui` and `nav_token` on `LaunchpadAccount<T>` accumulate from trade fees AND on-chain service payments. Non-withdrawable. Backs the hire-price view.
- **AgentTreasury<T>** — a sibling object holding the agent's working capital (`Coin<SUI>`, `Coin<T>`, and inbound coins via transfer-to-object). Separate from NAV. Withdrawable.
- **OwnerCap / OperatorCap** — two-tier custody. `OwnerCap` is transferable (`key + store`) and gates sovereign actions. `OperatorCap` is scoped with Move-enforced daily limit, allowlist, TTL, and revocation. Cap-rotation on operator compromise is cheap; the treasury is safe.
- **Productive coin** — the token is a hire ticket, access pass, and revenue claim. Optional `access_threshold` for token-gated hire; optional `accept_coin_payments` for coin-denominated payments (with burn-on-payment via `TreasuryCapHolder<T>`).
- **Self-referential cred** — the hire-price multiplier scales with lifetime SUI service revenue. No external feedback system required. SAI integration ships v1.5 as a separate adapter.
- **Sui-native object-bound custody** — assets follow the agent's object identity, not an operator key. Transferring `OwnerCap` IS transferring the agent's bank account.

The Move package is named **`tai`**. Module layout: `tai::launchpad` (core types + admin + launch + trade + service payments + access), `tai::bonding_curve` (pure math), `tai::fees` (split + distribute), `tai::agent_treasury` (treasury + caps + spend), `tai::views` (hire-price). The CLI is **`tai-cli`** and the SDK is **`@tai/sdk`**.

---

## Primary access surface: `tai-cli`

Tai's canonical interface is a single Rust binary. Any agent runtime — Eliza, Virtuals, 01 Pilot, custom Node/Python/Go — invokes `tai` as a subprocess. JSON output is the default when stdout is piped; pretty TTY output otherwise. Three built-in signer modes: local Ed25519, Sui keystore inheritance, and TEE-attested signing via Phala Cloud + Mysten Nautilus.

> **Note on sponsored gas.** Sponsorship is a CLI/SDK runtime concern that uses Sui's sponsored-transaction protocol at PTB-construction time. The Move package neither implements nor enforces it; the layer above (`tai-core` / `tai-cli`) decides whether to inject a sponsor.

```sh
tai init --signer-mode tee --tee-endpoint $PHALA_URL --network testnet

LAUNCH=$(tai launch \
  --name "Larry the Analyst" \
  --symbol LARRY \
  --image-blob "$WALRUS_BLOB_ID" \
  --owner-cap-recipient "$AGENT_ADDR" \
  --operator-cap-recipient "$AGENT_ADDR" \
  --operator-daily-limit-sui 10000000000 \
  --operator-ttl-days 90 \
  --output json)

LAUNCHPAD=$(echo "$LAUNCH" | jq -r .launchpad_id)
TREASURY=$(echo "$LAUNCH" | jq -r .agent_treasury_id)

# Agent earns from a paid hire:
tai pay sui --launchpad "$LAUNCHPAD" --coin-type "$COIN_TYPE" --payment-coin "$COIN_ID"

# Agent pays a third party within its OperatorCap's allowlist:
tai op spend-sui --treasury "$TREASURY" --operator-cap "$OP_CAP" \
  --amount 100000000 --to "$RECIPIENT"
```

No browser, no OAuth, no env-var paste. The agent IS the runtime; the CLI is its tool. See [`SPEC.md`](./SPEC.md) §12 for the full access-surface layering.

---

## Three modes — same primitives

The OwnerCap / OperatorCap pair supports three operational shapes, distinguished only by who holds what:

| Mode | OwnerCap holder | OperatorCap holder | Trust anchor |
|---|---|---|---|
| **Sovereign agent** | Agent's TEE-bound address | Same address (or session key) | TEE attestation |
| **Commissioned agent** | Human commissioner's wallet | Agent's runtime address | Human's wallet |
| **Spawned sub-agent** | Parent agent's OwnerCap holder | Sub-agent's runtime address | Transitive from parent |

Mode is not stored on-chain — it's an emergent property of cap distribution at launch. The CLI's `--owner-cap-recipient` and `--operator-cap-recipient` flags let any mode be configured. See [`SPEC.md`](./SPEC.md) §5.12.

---

## Why Tai exists

- **Bags.fm on Solana** gives end-creators ~25% of trade fees via Meteora DBC partner-case routing.
- **Pump.fun** gives end-creators nothing on the curve.
- **Neither pays the agent's treasury for actual work the agent does.**
- **No Sui-native launchpad ships** programmatic fee redirect + on-chain treasury growing from both trading and operating revenue + a productive-token model + Move-enforced custody under one roof.

Tai fills that gap. The launchpad is also the pool, the NAV is a real on-chain balance, the coin is the hire ticket, and the hire-price view reflects the agent's real track record — a number any Sui contract can read and trust.

---

## The two economies

Every Tai agent runs two parallel economies on the same `LaunchpadAccount<T>`. They share a treasury (NAV) but the protocol distinguishes them where it matters:

**Backer economy** — the bonding-curve pool. Permissionless price discovery; anyone with SUI can buy or sell the agent's coin. Speculation welcome. Each trade pays a 1% fee; 30% of that fee feeds the agent's NAV. Volatility and pump-and-dump are explicit features — they're just another path for SUI to flow into the productive treasury.

**Productive economy** — the service-payment rail. Paid hires (direct or escrowed via `work_order`), sponsored posts, agent-to-agent settlement. Each payment pays a fee; 40% of that fee feeds NAV, and the *full payment amount* increments `lifetime_service_revenue_sui` — the only number that moves the cred multiplier.

```
hire_price = NAV × cred_multiplier
where:
  NAV is fed by BOTH backer trades AND productive payments,
  but cred_multiplier is fed ONLY by productive payments.
```

Consequence: two agents with the same NAV can have very different hire prices. An agent fattened by speculation has cred = 1.00x; an agent fattened by real work has cred up to 2.00x. The protocol prices productive wealth higher than speculative wealth — automatically, without policing speculation.

**This is the load-bearing differentiator from pump.fun.** Pump.fun has only the backer economy. Tai has both, composing on the same primitives. Backers and operators don't compete; they both grow the same agent.

---

## Where to start (new agents)

1. Read [`SPEC.md`](./SPEC.md) end-to-end. It is the authoritative design document.
2. Read [`PLAN.md`](./PLAN.md). Start at Phase 0 and proceed task-by-task.
3. The implementing agent uses TDD: every entry function gets a failing `tests/*.move` test first.

---

## Key constraints (must read before coding)

- **Chain:** Sui only. Move 2024.beta, Sui framework rev `95cddc3f5`.
- **No SAI dependency in v1 core.** SAI integration is a separate adapter package shipped when both projects mature.
- **No Ika dependency in v1 core.** Cross-chain custody (BTC/ETH/Solana via Ika dWallets) ships as `Tai-Ika-Adapter` in v1.1. The linkage field `dwallets_object_id: Option<ID>` is reserved on `LaunchpadAccount` so the adapter slots in without breaking the v1 object layout.
- **CLI-first.** The Rust `tai-core` crate is the source of truth. The CLI wraps it for agent runtimes; the WASM-backed TS SDK wraps it for JS-native agents; the optional web demo wraps the SDK. Documentation leads with CLI examples.
- **No emojis** in code, comments, or commits.
- **TDD discipline:** every entry function gets a `tests/*.move` test BEFORE implementation. The PLAN enforces this.
- **All math `u128`-safe.** Every multiplication uses `u128` intermediates with explicit `assert!(x <= MAX_U64, EMathOverflow)` before downcast.
- **One responsibility per file.** Modules split by responsibility: `launchpad` (core types + launch + trade + service payments), `bonding_curve` (pure math), `fees` (splits), `agent_treasury` (treasury + caps + spend), `views` (hire price).

---

## What is OUT of scope for v1

These are deferred — do not implement them in v1 even if you have ideas:

- **SAI hard-dependency.** SAI is an adapter package.
- **Ika integration.** Cross-chain custody ships v1.1 as `Tai-Ika-Adapter`. The `dwallets_object_id` field is reserved.
- **Graduation event / LP release.** v1 trades on the bonding curve indefinitely.
- **Cetus mirror pool.** Optional v1.5.
- **DeepBook integration.** Deferred to v2 behind explicit volume gate.
- **Holder distribution claim flow.** Revenue plumbing ships v1; per-holder claim is v1.5.
- **One-transaction launch.** v1 is two-tx (publish + launch); one-tx via on-client bytecode templating is v1.5.
- **On-chain hire-flow object with escrow.** v2.
- **Sub-agent composition with on-chain revenue splits.** v2.
- **NFT custody via Kiosk.** v1 uses dynamic fields; Kiosk integration is v1.5.
- **USDC-quoted curves.** v1 is SUI-quoted; USDC is v1.5.
- **Cred decay.** Multiplier saturates monotonically in v1; decay is v1.5.

If a primitive is not listed in [`SPEC.md`](./SPEC.md) §4 (Object Model) or §5 (Mechanism), it is out of scope. Do not invent.

---

## Directory layout (post-implementation)

```
Tai-Launchpad/
├── README.md                       # This file
├── SPEC.md                         # Authoritative design spec
├── PLAN.md                         # Phased TDD implementation plan
├── move/                           # Sui Move package
│   ├── Move.toml                   # name: tai
│   ├── sources/
│   │   ├── launchpad.move          # core types + launch + trade + service + access + admin
│   │   ├── bonding_curve.move      # pure AMM math (u128)
│   │   ├── fees.move               # split + distribute (trade / service / token)
│   │   ├── agent_treasury.move     # AgentTreasury<T> + OwnerCap + OperatorCap + spend
│   │   └── views.move              # effective_hire_price + hire_quote
│   └── tests/                      # Move TDD coverage
├── rust/                           # Rust workspace
│   ├── Cargo.toml                  # workspace
│   ├── tai-core/                   # PTB builders, signer trait + impls, indexer, templater
│   └── tai-cli/                    # `tai` binary; clap-based command tree
├── sdk/                            # @tai/sdk (TypeScript, WASM-backed)
├── landing/                        # Marketing landing page (Next.js)
├── examples/
│   ├── cli-quickstart/             # Shell script: full lifecycle end-to-end
│   ├── tee-agent/                  # Phala Cloud + Nautilus reference deployment
│   └── sdk-quickstart/             # TypeScript SDK quickstart
└── docs/                           # MODES.md, CLI.md (Phase 14 deliverables; not yet present)
```

The Move package is named **`tai`** (lowercase, Sui convention). Module names: `tai::launchpad`, `tai::bonding_curve`, `tai::fees`, `tai::agent_treasury`, `tai::views`. The CLI binary is `tai`. The npm package is `@tai/sdk`.

---

## v1.x and v2 roadmap (do NOT implement in v1)

- **v1.1: `Tai-Ika-Adapter` package.** Cross-chain agent treasuries via Ika dWallets. BTC / EVM / Solana / EdDSA-family chains. OperatorCap policy applies uniformly across chains.
- **v1.5: Bonding-curve graduation.** Add `graduate_account<T>(account, dex_router)` — when an agent's `cumulative_volume_sui` crosses a threshold, the locked LP reserve migrates into a Cetus or Aftermath AGENT/SUI pool. Curve trades stop; DEX trades start. NAV continues to accumulate from trade fees on the new pool. Solves the v1 LP-permanent-lock and opens the door to AGENT/USDsui pairs.
- **v1.5: Stablecoin-denominated service payments.** Add `record_service_payment_stablecoin<S>` + `settle_stablecoin_payment<S>` (deferred-settlement pattern) so the user-facing payment moment can use Sui's protocol-level gasless stablecoin transfer (`coin::send_funds<USDsui>`), with protocol bookkeeping running in a separate sponsored tx.
- **v1.5: Tai-SAI-Adapter.** Composes SAI cred multiplier with Tai's self-referential cred.
- **v1.5: Holder distribution claim flow.** Per-holder accrual via dynamic fields or Merkle airdrops.
- **v1.5: USDC-quoted curves and service payments.**
- **v1.5: Cred decay.**
- **v1.5: Kiosk integration** for agent-owned NFTs.
- **v1.5: Sponsored gas integration** (Shinami / Sui Gas Pool) for everything that doesn't qualify for protocol-level gasless transfers.
- **v2: DeepBook integration** behind volume gate.
- **v2: Capability lending / skill leasing.**
- **v2: Sub-agent composition** with parent-child revenue splits.
- **v2: Collateralization adapter** (NAVI / Suilend).
- **v2: USDsui-denominated NAV** (`LaunchpadAccount<T, NUM>` generic-over-numeraire).
- **v2: Multi-milestone work orders** with structured arbitration committee.

See [`SPEC.md`](./SPEC.md) §9 for the full roadmap.

---

## Sibling projects under the Tai umbrella

- [`../SAI-SuiAgentIndex`](../SAI-SuiAgentIndex) — Sui Agent Index. Identity + reputation overlay. Optional integration via `Tai-SAI-Adapter` (v1.5).
- [`../Tai-Live`](../Tai-Live) — Decentralized streaming on Walrus.
- [`../Tai-Meet`](../Tai-Meet) — Private video conferencing.
- [`../Tai-Landing`](../Tai-Landing) — Umbrella brand site.

Tai-Launchpad is the on-chain economic layer. The Tai Network sibling projects share the brand and Sui-first design philosophy but are otherwise independent.
