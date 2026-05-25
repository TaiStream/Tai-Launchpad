# Tai Launchpad — Devlog

A running diary of what got built, what got cut, and what surprised me. Newest entry first. Commit messages cover *what*; this file covers *why* and *what I almost did wrong*.

---

## At a glance

| | |
|---|---|
| **Status** | Tai v1.0.1 live on Sui testnet · reference agent Larry hired and paid on-chain · reference runtime live on Cloudflare Workers |
| **On-chain — Tai protocol** | package [`0xb41f…6909`](https://suiscan.xyz/testnet/object/0xb41fa8ee7b2d902e706f197ec7e90484e4ded4347c6666d08eff09820e266909) · LaunchpadConfig [`0xe2ec…a1f0`](https://suiscan.xyz/testnet/object/0xe2ec37d9edf190d94835a6163cdd079ca296196475dd4969a890396b94daa1f0) |
| **On-chain — Larry the Analyst** | LaunchpadAccount [`0x8831…c36e`](https://suiscan.xyz/testnet/object/0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e) · OwnerCap with Display registered |
| **Larry's runtime** | https://larry-the-analyst.guanyidu98.workers.dev |
| **Marketing site** | https://tai-launchpad.vercel.app |
| **Repo** | https://github.com/TaiStream/Tai-Launchpad |
| **Tests** | 66 Move · 33 Rust unit · 4 Rust live-testnet integration — all green |
| **Commits to date** | 28 since project start |
| **Calendar age** | ~2.5 days |

---

## Where this goes next

- **Phase 12 — `tai-cli`** — Rust binary wrapping `tai-core`. Argparse + JSON output + 4 signer modes (Ed25519, Sui keystore, Turnkey, TEE-attested). Turns "use this from Rust" into "any agent runtime can shell out to it."
- **Phase 13 — `@tai/sdk`** — WASM-backed TypeScript wrapper over `tai-core`. JS-native agent runtimes get the typed surface without re-implementing PTBs.
- **OTW templater** — turns the current two-step launch (publish OTW coin module then call `launch_agent_coin`) into one shell command. The blocker is bundling a Move compiler or pre-baked bytecode patching; deferred to v1.5.
- **Sovereign-mode agent reference** — sibling of the CF Worker example but with an OperatorCap signer held in a Phala Cloud TEE. Demonstrates the "agent owns itself" mode.
- **Mainnet** — testnet only today. Mainnet wants `set_creator`, sponsored-gas budgeting, and a real audit pass.

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
- `landing/public/mascot.png` (served from Vercel CDN)
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
