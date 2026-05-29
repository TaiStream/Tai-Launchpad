# Tai Launchpad — Devlog

A running diary of what got built, what got cut, and what surprised me. Newest entry first. Commit messages cover *what*; this file covers *why* and *what I almost did wrong*.

---

## At a glance

| | |
|---|---|
| **Status** | Tai v1.1.2 live on Sui testnet (unaudited) · `tai-cli` 0.1.0 and `tai-core` 0.1.0 on crates.io · one site (marketing + dashboard + docs + gallery) live · Larry stays on legacy v1.0.1 |
| **Install** | `cargo install tai-cli` (also requires the `sui` CLI on PATH) |
| **On-chain — Tai protocol** | callable package v1.1.2 [`0xc5d0…a421`](https://suiscan.xyz/testnet/object/0xc5d0d885f6c652413034d3e44a1f9a7ab6ef6d94b6e951b6ee885e2edee3a421) · LaunchpadConfig [`0x4a8b…3c50`](https://suiscan.xyz/testnet/object/0x4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50) · types/events anchored to origin `0x7d86…efb3` |
| **On-chain — Larry the Analyst** (legacy v1.0.1) | LaunchpadAccount [`0x8831…c36e`](https://suiscan.xyz/testnet/object/0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e) · OwnerCap with Display registered |
| **Larry's runtime** | https://larry-the-analyst.guanyidu98.workers.dev |
| **Site** | https://tai-launchpad.vercel.app · browse + hire agents at `/agents` · agent brief at `/llms.txt` |
| **Repo** | https://github.com/TaiStream/Tai-Launchpad |
| **Tests** | 97 Move · 40 Rust (+ 4 live-testnet integration, ignored by default) — all green |
| **Commits to date** | 28 since project start |
| **Calendar age** | ~4 days |

---

## The pitch (use this for the submission)

Every Tai agent runs **two parallel economies on the same on-chain account**:

- **The backer economy** — the bonding-curve pool. Pump and dump welcome. 30% of every trade fee feeds the agent's NAV. This is the path pump.fun ships.
- **The productive economy** — the service-payment rail. Paid hires, escrow, sponsored posts. 40% of every payment feeds NAV, and the full payment increments `lifetime_service_revenue_sui` — the only number that moves the cred multiplier.

`hire_price = NAV × cred_multiplier`. NAV is fed by both economies. Cred is fed only by the productive one. So two agents with identical balance sheets but different revenue mixes have different hire prices — the protocol prices productive wealth higher than speculative wealth, automatically.

That's the differentiator from pump.fun: same primitive at the trading layer, plus a second economy on top that the trading layer can't game. Backers and operators don't compete; they both grow the same agent.

## Where this goes next

- **v1.5: bonding-curve graduation** — threshold-triggered LP release into a Cetus AGENT/SUI pool. Unlocks AGENT/USDsui pairs and deeper liquidity.
- **v1.5: stablecoin-denominated service payments** — `record_service_payment_stablecoin<S>` + deferred settlement, designed against Sui's new protocol-level gasless stablecoin transfers (`coin::send_funds<USDsui>` qualifies; protocol bookkeeping runs in a separate sponsored tx).
- **v1.5: sponsored gas integration** — Shinami or Sui Gas Pool for everything that can't be gasless.
- **OTW templater** — already shipped (`tai launch` is a single shell command).
- **Sovereign-mode agent reference** — already shipped (`examples/sovereign-agent/`, TEE-upgrade-path documented).
- **Mainnet** — testnet only today. Multi-sig admin, external audit, two-step creator transfer all on the P0 list.

---

## 2026-05-27 — Sovereign reference agent, wallet-connect, OTW launch templater. Three things in one afternoon.

After v1.1 landed the on-chain payment rail, the work that mattered next was adoption-shaped — closing the gaps between "the protocol can do this" and "anyone can do this." Three pieces, each shipped:

**1. Sovereign-mode reference agent (`examples/sovereign-agent/`).**

Sibling to Larry's CF Worker, opposite custody model. Larry is commissioned mode — Worker holds no keys, the hirer signs every on-chain payment themselves. The sovereign agent is the opposite: it owns its own Ed25519 keypair, holds its own `OwnerCap<T>` + `OperatorCap<T>`, and signs every on-chain action from inside the Worker. Same Move primitives, opposite cap distribution at launch.

The runtime is designed for TEE deployment (Phala Cloud, Mysten Nautilus, AWS Nitro, Intel TDX). In the demo it runs on Cloudflare Workers with the seed sealed as a Worker Secret — the same access model from the runtime's perspective, weaker against host compromise. A `/attestation` endpoint returns a stub today and documents the upgrade path to real RA-TLS quotes.

The shape is four files: `src/signer.ts` (Ed25519 signing with `@noble/ed25519` + `@noble/hashes/blake2b`; 97-byte Sui wire format), `src/sui.ts` (verification + tx submission via `unsafe_moveCall` + `executeTransactionBlock`), `src/index.ts` (routes), and a long README walking through the launch ceremony.

Three real differences from Larry, materially:

- **The agent can spend from its own treasury.** `operator_spend_sui` is the call. Useful for paying an LLM API out of accumulated revenue without involving the human owner. Subject to the OperatorCap's daily limit, allowlist, and TTL.
- **The agent can accept work-order escrow hires.** New v1.1 surface: `accept_work_order_with_operator` then `submit_receipt_with_operator`. The agent acknowledges and delivers entirely from its own keys; the buyer or anyone-after-window releases.
- **The agent has an identity.** `GET /` shows its address, on-chain ids, and TEE-mode badge. Future verifiers will check `/attestation` before trusting messages.

I didn't run the launch ceremony today (no fresh on-chain agent yet). The README documents the four-step ceremony; one `wrangler deploy` after step 3 makes it live.

**2. Wallet-connect actions in the dashboard.**

The dashboard went from read-only (v1.0 era) to read-write today. `@mysten/dapp-kit` + `@mysten/sui` integrated at the layout level: a single `WalletProvider` mounts `QueryClientProvider` → `SuiClientProvider` → `WalletProvider` once, every page consumes `useCurrentAccount()` / `useSignAndExecuteTransaction()` without re-creating state.

Two action panels do the heavy lifting:

- **`HireForm`** on `/agent/[id]`: connects with the wallet, builds a one-PTB tx (`tx.splitCoins(tx.gas, [amount])` then `tx.moveCall work_order::create_work_order<T>`), signs and executes. Default amount pre-fills from the agent's current cred-adjusted hire price. On success the user sees a tx digest + Suiscan link.
- **`WorkOrderActions`** on `/work/[id]`: state-aware button set. If you're the buyer + status=RECEIPT_SUBMITTED + in dispute window → you see `release` + `dispute`. If you're past the deadline with no receipt → you see `refund`. If you hold a cap targeting this agent → you see `accept (owner cap)` / `accept (operator cap)` (after pasting the cap id). And so on through the state machine.

The chip in the nav was the only non-obvious styling — dapp-kit's stock `ConnectButton` is blue and round-cornered; an inline `<style>` overlay matches the rest of the dashboard's phosphor/amber aesthetic.

Three notes worth recording for next time:

- `createNetworkConfig` requires both `url` and `network: "testnet"` in v1.x; the type error wasn't obvious from docs.
- `tx.pure.vector("u8", [])` is the empty-byte-vector arg for the spec hash; the dapp-kit-shipped transaction builder is strict about pure-arg encoding.
- `useSignAndExecuteTransaction` is mutation-flavored (`mutate` + `isPending`), not promise-flavored. Wrapping it in `await new Promise(resolve => { mutate({}, { onSuccess, onError }); })` is the cleanest interop with async/await.

**3. OTW launch templater (`tai launch`).**

The biggest UX gap was that launching an agent took two steps: publish a coin OTW module with `sui CLI`, then chain `launch_agent_coin` separately. `tai launch` collapses both into one shell command.

The trick that doesn't quite work — bundling a Move compiler in the CLI binary — would have been a months-long Yak shave. The trick that does work: generate a Move source file at runtime from a template, shell out to `sui client publish --json` to compile + publish it, parse the JSON to extract the freshly-minted TreasuryCap + CoinMetadata ids, then call `launch_agent_coin<T>` via `tai-core`'s in-process Move-call builder.

Template lives at `rust/tai-cli/templates/agent_coin/`:

- `Move.toml.tmpl` — pinned to the same `95cddc3f5...` Sui framework rev the main `tai` package uses, so the generated coin can be safely consumed by `launch_agent_coin`.
- `sources/coin.move.tmpl` — `{{MODULE_NAME}}` (lowercase) + `{{WITNESS_NAME}}` (uppercase) placeholders, plus the metadata constants. Strings are baked as `b"..."` literals, which means inputs must be printable-ASCII; non-ASCII inputs are rejected at generation time.

Module names are derived per-launch as `<symbol_prefix>_<8-hex>`. The prefix is `agent` if the symbol has no ASCII letters. Witness is the module uppercased. No two launches can collide because the random suffix is part of the on-chain coin type.

The publish JSON parser walks `objectChanges` looking for `0x2::coin::TreasuryCap<…::module::WITNESS>` and `0x2::coin::CoinMetadata<…::module::WITNESS>` — those are the two ids needed to call `launch_agent_coin`. Templates compile cleanly through `sui move build` (smoke-tested today against a `demo_smoke` render).

I did not run an end-to-end launch on testnet today — the templater is wired, the template builds, the publish parser has unit-test coverage. The next time a fresh agent needs launching, `tai launch --symbol X --name "Y"` is the new path.

Subtleties I want to preserve for future-me:

- **Tokio's `process` feature is opt-in.** Workspace's default tokio features don't include it; `tai-cli` has to enable it explicitly in its own Cargo.toml entry.
- **Why `tempfile` survives the async block.** The `TempDir` guard is held in `cmd_launch`'s scope; if the `sui publish` step fails, the temp dir auto-cleans on drop, which is the right behavior.
- **Publish-only mode (`--publish-only`).** Lets you run the publish step in isolation when debugging the template or the JSON parser. Returns the ids you'd need to do the launch step manually.

Cumulative state after these three:

- **91 Move tests** (unchanged this round, but the work_order tests are now exercised more in practice via the wallet-connect path).
- **40 Rust unit tests** (was 36; +4 new launch templater tests).
- **Dashboard re-deployed** to https://tai-app-lyart.vercel.app with wallet-connect live across `/`, `/agents`, `/agent/[id]`, `/hire`, `/work/[id]`.

What's left for v2-ish:

- Real on-chain launch of the sovereign agent (one wrangler ceremony plus the templater).
- TEE deployment of the sovereign agent (Phala Cloud onboarding).
- Mainnet hardening pass (sponsored gas, set_creator audit, external audit, two-step admin's escape hatch documentation).
- v2 work_order: token-denominated escrow, milestone payments, arbitration committee.

The protocol surface is feature-complete for v1's claim — "Sui-native tokenized agentic infrastructure with an agent-to-agent payment rail." Everything ahead is adoption + hardening.

---

## 2026-05-27 — v1.1.0. Agent-to-agent payments are real now.

The thing that turns Tai from "tokenized agent infrastructure" into "tokenized agent infrastructure that two agents can actually transact on" is escrow. Direct payment via `record_service_payment_sui` works — Larry has been earning real hires that way — but it asks the buyer to trust the agent before any work is delivered. Real payment rails need locks, receipts, and dispute paths. So v1.1 ships `tai::work_order`.

**What it is, in one line:** a generic `WorkOrder<T>` shared object that holds locked SUI and routes through `record_service_payment_sui<T>` on release — so escrow doesn't fork the economics, it just adds safety. NAV grows. Cred accumulates. Same fee split. The buyer just gets a second chance to say "actually, no" before the funds settle.

**State machine, in one diagram:**

```
NEW ──accept──> ACCEPTED ──submit_receipt──> RECEIPT_SUBMITTED
 │                 │                              │
 │                 │                              ├─ release ─> RELEASED
 │                 │                              ├─ open_dispute ─> DISPUTED ──> admin_resolve
 │                 │                              └─ window expires ─> anyone releases ─> RELEASED
 └─────── refund (after deadline) ───────────────> REFUNDED
```

Some design calls worth recording:

- **Generic in `T`, locked in SUI.** WorkOrder<T> is parametrized by the payee's coin type so release can call `record_service_payment_sui<T>` against the matching `LaunchpadAccount<T>`. The locked balance is `Balance<SUI>` — token-denominated escrow is a separate v1.5 feature.
- **Two acceptance paths.** Owner-cap and operator-cap both work via separate entry functions (`accept_work_order_with_owner` / `_with_operator`). I split them rather than passing a generic capability because the OperatorCap path can be policy-gated in v1.5 (e.g. require allowlist contains `buyer`); keeping the entry points separate makes that future change additive.
- **`anyone_can_finalize_after_dispute_window_elapses`.** The whole reason the dispute window exists is to give the buyer a chance to flag bad delivery. If the buyer ignores the order, the funds shouldn't sit forever — anyone can poke the order to finalize. The payee can't grief by waiting; a third-party finalizer (think: the agent itself, or a watcher script) closes it.
- **Buyer cannot refund after a clean receipt.** Once the payee delivers, the only way out for the buyer is `open_dispute`. Otherwise refund + receipt would race and we'd need a status lock; instead we just close the refund door at receipt-submission time. Simple.
- **Admin resolves disputes.** v1.1 keeps the resolver as `config.admin`. A real arbitration committee is v2. Documented as a known limitation up front so nobody confuses this with a Kleros clone.
- **`MIN_AMOUNT_MIST = 1_000` and `MAX_DISPUTE_WINDOW_MS = 30 days`.** Tiny dust orders would let an attacker spam shared-object creation; the floor makes spam slightly expensive. The window cap stops anyone from setting a 100-year hold.

**Bundled with the audit backlog so this could ship as one fresh publish:** MEDIUM-2 share floors (admin can't zero out creator or NAV), MEDIUM-3 `operator_spend_token` (with its own daily limit, sharing the same epoch-day rollover), LOW-1 `MAX_ALLOWED_TARGETS = 64`, LOW-2 `update_operator_cap_targets` for in-place mutation, LOW-6 two-step admin (`propose_admin` → `accept_admin` → `cancel_pending_admin`, pending_admin field), LOW-7 `set_dwallets_object_id` (creator-only Ika pointer), LOW-8 distinct `EOperatorCapNotActive`, and `set_creator` so creator-ship can be transferred. The remaining audit items (LOW-3, LOW-4, LOW-5b, LOW-9, INFOs) are not blockers and are documented in chat.

**Tests went from 71 → 91.** The new 17 work_order tests cover: happy path (owner-cap accept + submit + buyer-release), operator-cap acceptance, anyone-can-finalize-after-window, buyer refunds before acceptance, buyer refunds after acceptance with no receipt, refund-blocked after clean receipt, foreign-cap rejection, buyer-opens-dispute → admin resolves to payee, buyer-opens-dispute → admin resolves to buyer, dispute window expiry blocks new disputes, non-admin can't resolve, and three creation guards (dust below 1000 MIST, deadline in past, dispute window > 30 days).

**Republish v1.1.0** (not an upgrade, same reason as v1.0.2 — adding a module + new struct fields = layout change). Cost 0.19 SUI. Larry stays on v1.0.1 because his runtime is wired against the v1.0.1 entry shape and there's no product win in relaunching him today.

- v1.1.0 package: `0x7d86…efb3`
- v1.1.0 LaunchpadConfig: `0x4a8b…3c50` (verified: `version: "1"`, `pending_admin: None`)
- v1.1.0 UpgradeCap: `0x15db…5467`
- v1.1.0 Publisher: `0x2ce7…352f`
- Tx: `HgkcB4UURjxHRfAhCebRjKPgrp5zc7VmmM1c33JGPKfA` at checkpoint 341424845

**Rust side** got a new `tai_core::work_order` module with `WorkOrderView`, `WorkOrderStatus`, and a full bag of PTB builders on `TaiClient`: `work_order_create`, `work_order_accept_with_owner`, `work_order_accept_with_operator`, `work_order_submit_receipt_with_owner`, `work_order_submit_receipt_with_operator`, `work_order_release`, `work_order_refund`, `work_order_open_dispute`, `work_order_admin_resolve`. CLI surface: `tai hire`, `tai work {show,accept,submit-receipt,release,refund,dispute}`. 36/36 Rust unit tests pass.

**Dashboard app got a hiring portal.** New routes:

- `/hire` — browse every agent, see live hire prices, recent work orders chain-wide, CLI usage hint
- `/work/[id]` — per-order page with a live state-machine visualization (`new → accepted → receipt → released`), spec/receipt panels, status-aware CLI hints for what to do next
- Per-agent dashboard gained a "work orders" panel that lists every escrow targeting that agent, color-coded by status

The aesthetic stays: dense, monospace, phosphor-and-amber, live RPC reads on a 15–20s poll. The hiring portal page even has a little 6-step "how it works" diagram in the side panel because escrow is the kind of thing that benefits from being read top-to-bottom once.

Deployed to https://tai-app-lyart.vercel.app. Cumulative URLs: marketing at tai-launchpad.vercel.app, dashboard at tai-app-lyart.vercel.app, Larry's runtime at larry-the-analyst.guanyidu98.workers.dev.

What's next: this is the point where v1.1 stops being protocol work and starts being adoption work. The natural next chapters are (a) the OTW launch templater so `tai launch --name X --symbol Y` is a single command, (b) the sovereign-mode TEE agent example as a second reference next to Larry, and (c) wallet-connect actions in the dashboard so humans can hire from the browser, not just the CLI. (a) is the highest UX leverage; (b) is the highest narrative leverage; (c) bridges the two.

The on-chain side is now substantively feature-complete for what an agent-to-agent payment rail needs. Next time we touch Move it should be mainnet hardening.

---

## 2026-05-25 — Audit, then four fixes, then v1.0.2 in one afternoon.

Two questions I asked the codebase today, in order:

1. *Where does the auditor's eye land?*
2. *If we ship those fixes right now, what breaks?*

The audit was a line-by-line read of all 1,601 lines of Move under `move/sources/`. Goal was to find: NAV escape paths, LP drain paths, admin overreach, integer overflow, cross-object linkage gaps, OTW pattern issues, missing version scaffolding. Nothing critical. Five mediums, nine lows, twelve informationals. The summary is in chat for now — clean enough that the right thing was to pick a small batch and ship.

The batch I picked: **MEDIUM-1 + MEDIUM-4 + MEDIUM-5 + LOW-5.** Three are scoped behaviour tweaks (admin can't set a >10% trade fee; `fees::compute_split` refuses bps that would underflow; operator caps can't be issued for >1 year). The fourth, LOW-5, is the load-bearing one: a `version: u64` field on `LaunchpadConfig` and `LaunchpadAccount<T>`, with `migrate_config` / `migrate_account` scaffolding for future upgrades. Adding a struct field is a layout change, so v1.0.2 is a *fresh publish*, not an upgrade. That was already the v1.0.1 pattern, so the cost was familiar — a `Published.toml` reset plus a Sui faucet poll while gas was tight.

Tests went from 66 → 71. Each new test is a deliberate red→green for the new assertions:

- `trade_fee_above_cap_aborts` — `set_trade_fee_bps(1001)` must abort with `EFeeBpsTooHigh`.
- `fresh_config_has_current_version` — `config.version == 1` immediately after `init`.
- `migrate_config_aborts_when_already_current` — calling `migrate_config` on a fresh config aborts with `EAlreadyCurrentVersion`. (The migration scaffolding is for *future* upgrades; on v1.0.2 there's nothing to migrate from.)
- `issue_operator_cap_aborts_when_ttl_exceeds_one_year` — 1 year + 1 ms must trip `EOperatorTtlTooLong`.
- `split_aborts_when_nav_plus_creator_exceeds_denominator` — `compute_split(_, 6000, 5000)` must trip `EFeeBpsInvalid` *before* the would-be u64 underflow on `total - nav - creator`.

The thing I almost did wrong: I almost defaulted to making `migrate_account` admin-only. It's tempting — it feels like a "privileged" operation. But account migration is just bumping a number to unblock the user's own object. If admin is busy or unreachable, every old account is bricked. Permissionless is the right call. `migrate_config` stays admin-only because there's exactly one config, and the admin already controls it.

**Larry stays on v1.0.1.** Relaunching him would have been a half-hour ceremony for zero product value — he's a legacy reference agent, the spec the Worker pays against is the v1.0.1 interface, and the on-chain story is *better* with a legacy agent alongside a v1.0.2 launchpad because it shows the version pattern is real, not theoretical. The README and DEVLOG both flag Larry as legacy v1.0.1 explicitly. Anyone launching a new agent goes against v1.0.2.

Gas was funny. I had 0.195 SUI total, largest single coin 0.135. First publish attempt died with `InsufficientGas`. The CLI doesn't auto-merge, so the budget cap is whichever single coin you point at. I ran a background `until curl` loop against the faucet (rate-limited 429s, polls every 30s) while I merged my smaller coins together; faucet came back ~2 minutes later with 1.1 fresh SUI, publish landed at 138.5M MIST (0.139 SUI). Cost is in line with v1.0.1 — adding a `u64` field across two structs barely moved the storage bill.

Cumulative state:

- v1.0.2 package: `0xa938…5026`
- v1.0.2 LaunchpadConfig: `0x4a21…15d8` (verified on-chain: `version: "1"`, all spec-default bps, admin = publisher)
- v1.0.2 UpgradeCap: `0xc334…bf6c`
- v1.0.2 Publisher: `0xed19…16ce`
- Publish tx: `3coikU29kUozpkCSCAh5qJhDCgzbFSSS7fkiZvkSH9pm` at checkpoint 340949445
- Tests: 71 Move + 33 Rust unit + 1 of 4 live-testnet integration verified end-to-end against the new config

What's next is pick-one-of-three: keep building the CLI surface (`tai buy`, `tai sell`, `tai treasury withdraw`, `tai op spend`); ship the sovereign-mode TEE agent example; or pause and take a bigger audit pass before mainnet. The MEDIUM-2 / MEDIUM-3 / LOW-1..LOW-9 backlog from this audit is documented and queued.

---

## 2026-05-25 — Builder day. Rust crate from zero, Larry on the internet.

### Built

- **Phase 11.1–11.3** — `rust/tai-core` crate scaffold + `Signer` trait + `Ed25519FileSigner` (full, with the Sui 97-byte wire format), `SuiKeystoreSigner` / `TurnkeySigner` / `TeeSigner` as `todo!()` stubs for v1.1
- **Phase 11.4** — JSON-RPC client + `LaunchpadConfigView` decoder. **First end-to-end Rust↔Sui** moment: `cargo test --release -- --ignored live_testnet_launchpad_config_matches_spec_defaults` fetches the deployed `LaunchpadConfig` and asserts all 17 SPEC defaults hold on-chain
- **Phase 11.4b** — `LaunchpadAccountView` (all 27 fields) + `AgentTreasuryView` + client-side `hire_quote()` that mirrors `views::hire_quote` byte-for-byte. Tests for the cred multiplier at zero / target / 2× target / partial revenue
- **Phase 11.5** — `TaiClient::execute_move_call` using `unsafe_moveCall` + signature + `sui_executeTransactionBlock`. Deliberately *not* pulling in `sui-sdk-types` — server-builds-tx is fine for v1, easy to swap to client-side BCS later
- **Phase 11.5b** — 15 typed write helpers covering every entry function in the chain. `MoveCall` argument builders for `Option<ID>` (Sui's `[]` / `[id]` array convention) and `vector<address>` / `vector<ID>`
- **Phase 11.5c** — **Launched Larry the Analyst** on testnet as the integration-test fixture. Four live testnet tests pass against him in 0.14s.
- **`Display<OwnerCap<T>>` ship** — see surprise below. Republished as v1.0.1.
- **Cloudflare Worker runtime** for Larry — `/hire` endpoint that verifies a `record_service_payment_sui` on-chain receipt before responding. Live and serving paid hires.

### What surprised me

**The Tai package can't gain a Publisher via upgrade.** I wanted to add `tai::publisher` and `tai::agent_display` modules to the deployed v1.0.0 package so wallets could render `OwnerCap<T>` as a custom card. Tried it: `FeatureNotYetSupported in command 1`. Bisected by trying a no-op upgrade (succeeded) and an upgrade with just `tai::publisher` (failed identically). The Sui protocol our package was published at doesn't support OTW-init for newly-added modules during an upgrade. The Publisher capability can only be claimed at original publish time. So v1.0.1 became a fresh republish, not a Sui-level upgrade. The v1.0.0 package at `0x7d41…4f8d` is now a historical artifact, documented in `move/published.json`'s `history` block.

**The Sui CLI version skew bit harder than I expected.** My local CLI was 1.61.1 from February. Testnet was on protocol 124, my CLI emits protocol 102. Upgrading via `brew upgrade sui` got me to 1.72.2 (homebrew at `/opt/homebrew/bin/sui` — the older one at `~/.local/bin/sui` is still first in PATH). Worth flagging that this kind of skew creates confusing error messages.

**The Worker design simplified itself.** I started planning to put an OperatorCap signer in the Worker so it could record its own service payments. Then realized: if the **hirer** calls `record_service_payment_sui` from their own wallet, the Worker doesn't need a key at all — it just verifies the on-chain receipt. Worst-case Worker compromise leaks the LLM API key, not any agent funds. That's the cleanest commissioned-mode pattern and it's what I shipped.

**The hire-flow end-to-end test required a second address.** Tai excludes self-payments from the cred multiplier (a self-pump guard) by setting `counted_toward_cred = false` when `payer == creator`. The Worker rejects those. So to verify the happy path I had to spawn a second testnet address (`0xe1a6…b639`), fund it from the main account, switch CLI active address, submit the payment, then verify. That's correct behavior on Tai's part — the design is working as intended — but it took an extra step to exercise.

**Wrangler "just worked."** First deploy at https://larry-the-analyst.guanyidu98.workers.dev was clean: `wrangler kv namespace create` → paste id into wrangler.toml → `wrangler deploy`. ~40 seconds total. KV-based replay protection working on first try.

### Numbers as of EOD

- Tests: 66 Move · 33 Rust unit · 4 Rust live integration · all green
- Live deployments: Tai v1.0.1 (testnet) · Larry v2 (testnet) · Display<OwnerCap<LARRY>> · Cloudflare Worker · marketing landing
- Testnet spend for v1.0.1 ceremony: ~0.16 SUI total (republish + relaunch + Display registration + ~0.013 wasted on failed upgrade attempts)
- Real hire transacted: 0.1 SUI from `0xe1a6…b639` (non-creator) → Larry's lifetime SUI service revenue is now non-zero. The cred multiplier has moved off baseline.

---

## 2026-05-24 — Mascot day.

### Built

- Adopted the og Tai project mascot (a medieval ink illustration of a fish with legs, on parchment) as the v1 sigil. Set it as OG image, Twitter card, and favicon. Added it as a frontispiece panel above the landing hero — then took it back out because the user said it was crowding. The mascot stays as identity (favicon + social cards + per-agent placeholder) but doesn't shout from the homepage.
- `docs/MASCOT.md` — variation guide across five axes (palette / pose / texture / marginalia / background state) + seven concrete archetype packs (Larry, Magnus, Coin, Sentinel, Hatchling, Ascended, Glitch) + the four invariants that have to hold across the family

### What surprised me

**The mascot is the project's strongest visual asset.** When I asked "what does an agent get from us," the user followed up with "the coin, the NAV, the NFT, the identity." That framing made me realize the on-chain primitives were richer than I was talking about — and the mascot was the one piece that was *visually* distinctive in a way that escapes "another modern crypto landing." Combining medieval ink art with the CRT/phosphor terminal palette is intentional anachronism; it works precisely because every individual choice is deliberate.

**Restraint wins on hero placement.** Adding the mascot to the hero felt right because the project finally had a face. Removing it felt right because the terminal cast was already doing the visual work. Both decisions were correct in their moment. The mascot now lives in:
- `app/public/mascot.png` (served from Vercel CDN)
- the OG meta tags (social previews)
- the favicon (browser tab)
- Larry's on-chain Display schema (wallet card)

---

## 2026-05-23 — Birth day. Design through Phase 10.

### Built

The whole protocol in one push, plus the public surface around it:

- **Design audit** of an inherited SPEC/PLAN. Found 8 issues. The biggest were: hard SAI dependency, dependency-cycle bug between `tai::launchpad` and `tai::fees`, integer overflow in fee math, and the SPEC promising "one-tx launch" that the Sui type system literally can't deliver
- **SPEC rewrite + PLAN rewrite** to drop SAI, fold in `AgentTreasury<T>` + `OwnerCap<T>` + `OperatorCap<T>` (object-bound custody), reserve `dwallets_object_id: Option<ID>` for v1.1 Ika integration, set the CLI (not the web) as the primary access surface
- **Marketing landing** in Next.js 16 + Tailwind 4 + TypeScript. CRT / phosphor palette, VT323 + IBM Plex Mono pairing. Deployed to Vercel at https://tai-launchpad.vercel.app
- **GitHub repo** under TaiStream org. Public, MIT
- **Move package phases 0–10:**
  - Phase 0: scaffold
  - Phase 1: LaunchpadConfig + 7 admin entry functions (15 tests)
  - Phase 2: bonding-curve math with `u128` intermediates (9 tests)
  - Phase 3: core structs (LaunchpadAccount, TreasuryCapHolder, AgentTreasury, OwnerCap, OperatorCap, all events)
  - Phase 4: `launch_agent_coin` — single atomic launch creates four shared objects + mints OwnerCap (+ optional OperatorCap)
  - Phase 5: fees module — `compute_split` + `distribute_sui` + `distribute_token<T>`
  - Phase 6: buy + sell (with the rounding fix — see below)
  - Phase 7: service payments (SUI + token, with burn) + access config (merged from Phase 9 because the token test needs it)
  - Phase 8: AgentTreasury operations — withdraw, top-up, claim-received, OperatorCap issue/revoke/spend with full Move-enforced policy
  - Phase 9: hire-price view
  - Phase 10: **published to Sui testnet** at `0x7d41…4f8d` (later superseded by v1.0.1 at `0xb41f…6909`). 66 tests passing
- **Audit fixes** — every gap from the self-review checklist closed in the same day

### What surprised me

**Ceiling-up on buy is non-negotiable.** Phase 2.2 was supposed to be straightforward — write `compute_sell`, mirror `compute_buy`. The path-dependence test `sell_after_buy_returns_less_than_paid` failed by 1 MIST. I dropped to Python with `pow(2, 128)`-grade integer arithmetic and confirmed: floor-on-buy + floor-on-sell creates a 1-MIST drift that breaks the `sui_gross <= real_sui` invariant on the sell leg. Fix: ceiling division on `new_total_token` in `compute_buy`. Documented in the commit message and later in SPEC §5.2. The bonding curve invariant is now provably preserved across arbitrary roundtrips at exact integer precision.

**The PLAN had a dependency cycle in it.** `tai::launchpad` was supposed to import `tai::fees` for the buy/sell hot path. `tai::fees` was importing `tai::launchpad` for `LaunchpadConfig` and `TreasuryCapHolder<T>`. Move rejects this on principle. Resolution: `tai::fees` became config-agnostic — `compute_split(total, nav_bps, creator_bps)` takes raw bps args, `distribute_token` takes `&mut TreasuryCap<T>` directly. Callers in `tai::launchpad` extract the bps from `LaunchpadConfig` and the cap via `lp::holder_cap_mut(holder)`. PLAN.md was updated to reflect the corrected design so future implementers don't hit the same wall.

**`public entry`** triggers a lint warning in modern Sui Move. The original PLAN used `public entry fun` for every admin function. Modern Sui (the linter) wants `public fun` — `entry` adds restrictions but no benefit on already-public functions. Removed the `entry` modifier from all entry-point definitions; tests still pass; lint is clean.

**Vercel rejected `next@16.0.5`** as security-vulnerable on first deploy. Bumped to `16.2.6` and tried again. The bump itself was uneventful. Lesson: always bump deps to latest patch before the first prod deploy — Vercel's vulnerability scanner blocks security-flagged versions even if your `npm audit` is clean locally.

**The original Vercel deploy was tagged as production by default.** First-ever deploy on a new Vercel project, the platform assigns it as production. My `vercel deploy --yes` (without `--prod`) still landed it as the production tag. Took a moment to realize the failed `16.0.5` build was showing up in the dashboard as "production: error" — fixed with a clean `vercel --prod` after the bump.

### Numbers at EOD-1

- Tests: 66 Move, all green
- Lines of Move: ~1,300 across 5 modules (launchpad, bonding_curve, fees, agent_treasury, views)
- Live: Tai v1.0.0 on testnet, ~0.12 SUI spent to publish
- Landing on Vercel (production URL public; preview URLs behind SSO)
- Repo at TaiStream/Tai-Launchpad, MIT

---

## Reading this devlog

The pattern of work has been: design pass → implementation pass → audit → republish. Each cycle revealed something the previous pass missed. Two examples that show up here:

1. The buy-side ceiling-rounding fix was triggered by writing a path-dependence test for the sell side. Without that test the curve would have been silently 1-MIST-wrong forever.
2. The `Display<OwnerCap<T>>` republish was triggered by a user prompt — "what makes this Sui-native agent infra?" — that forced me to enumerate what every agent actually receives on launch. The "OwnerCap as a wallet NFT card" gap surfaced as soon as I tried to list the per-agent objects in concrete terms.

The honest pattern is: each round of writing-it-down (SPEC, README answers, this devlog) catches things implementation alone misses. Worth budgeting time for.
