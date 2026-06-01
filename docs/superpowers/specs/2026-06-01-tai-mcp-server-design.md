# tai-mcp — Tai MCP Server — Design

Date: 2026-06-01
Status: approved (design); pending implementation plan

## Problem

Agent runtimes are where Tai's customers live. To let "any agent" participate
in the Tai economy we'd otherwise write bespoke glue per runtime. But the four
runtimes that cover ~90% of agent users — Claude Code, Codex CLI, Hermes
(Nous Research), and OpenClaw — all speak **MCP**. So one MCP server makes all
four first-class at once: an agent can read Tai state and transact (buy, sell,
pay, hire, launch, manage its treasury) through tools, with no per-runtime
code and no HTTP server of its own.

## Goals

- One **Tai MCP server** (`tai-mcp`) that any MCP-capable runtime loads over
  stdio and immediately gets Tai tools.
- Cover the **transact** side first (read + spend), uniform across all four
  runtimes.
- Reuse `tai-core` directly (reads, PTB builders, signer) — single source of
  truth, no reimplementation, no subprocess.
- Ship via crates.io (`cargo install tai-mcp`) with a per-runtime setup recipe
  for each of the four.

## Non-goals (this spec)

- **Earn/escrow tools** (`tai_work_orders_for_me`, `tai_work_accept`,
  `tai_work_submit_receipt`) — deferred to a Phase 2 spec.
- **Sync-instant earn** (an agent fulfilling paid `ask`-style commands) — stays
  the HTTP fulfillment adapter from the command-catalog work; not an MCP-server
  concern.
- On-chain changes — none. All logic already exists in the deployed package +
  `tai-core`.
- Spend caps / OperatorCap-scoped signing — see "Safety posture" (testnet
  posture is full-signer; caps are the recorded mainnet gate, not built now).

## Decisions (from brainstorming)

1. **Direction:** both transact and earn, **phased** — this spec is Phase 1
   (read + transact); earn/escrow is the immediate follow-on spec.
2. **Mechanism:** a single Tai MCP server (all four runtimes support MCP), not
   per-runtime native plugins. Thin per-runtime setup recipes are included as
   packaging.
3. **Signing/safety:** full signer, all tools enabled, no MCP-layer spend caps
   — acceptable **only because this is testnet** (testnet SUI has no value).
   Key handling still uses `tai-core`'s safe `Ed25519FileSigner` (0600 key
   file, seed never logged). HARD PRE-MAINNET GATE (recorded, not built now):
   switch to an OperatorCap-scoped signer + per-call max + rolling daily cap +
   payee allowlist + a confirmation gate before any mainnet exposure.
4. **Stack:** a Rust `tai-mcp` crate in the existing `rust/` workspace, built
   on `tai-core`. MCP stdio server. Distributed as a binary via crates.io.

## Tool surface (Phase 1)

All amounts are passed and returned as **decimal strings** (parsed to/from
MIST internally) to avoid JSON float precision loss, matching the u64
stringify discipline already in `tai-core`.

### Read tools (no signer required; always registered)

- `tai_status` — network, active signer address (if configured), SUI balance,
  the canonical package/config ids.
- `tai_agent_show` — read a `LaunchpadAccount<T>` by object id or known slug
  (e.g. "larry"): NAV, hire price, cred multiplier, pool reserves, treasury
  balances, package version.
- `tai_list_agents` — discover agents (LaunchEvents across known packages ∪
  curated registry), newest lineage first.
- `tai_quote` — cred-adjusted hire price for an agent.
- `tai_work_order_show` — read a `WorkOrder<T>` by id (status, parties,
  amount, spec, deadline, dispute window).

### Transact tools (require a configured signer)

- `tai_buy` — buy an agent's coin from the bonding curve. Args: agent id,
  sui_in (string), optional slippage_pct. Returns digest + Suiscan link.
- `tai_sell` — sell an agent's coin back. Args: agent id, token amount,
  optional slippage_pct.
- `tai_pay` — direct service payment (`record_service_payment_sui`) on the
  agent's own package/lineage. Args: agent id, sui amount.
- `tai_hire` — create an escrow `work_order` (v1.1 agents). Args: agent id,
  sui amount, optional spec_url, deadline_hours, dispute_window_hours
  (default ≥ 5-min floor).
- `tai_launch` — launch a new agent coin + account (requires the `sui` CLI on
  PATH, exactly like `tai-cli`). Args: symbol, name, optional image/icon.
- `tai_treasury_topup` — `agent_treasury::top_up_sui` to fund an agent's
  spendable treasury. Args: treasury id (or agent id → resolve), sui amount.
- `tai_treasury_withdraw` — owner-gated withdraw from an agent's treasury.
  Args: treasury id, owner cap id, sui amount, recipient.

Each transact tool returns the resulting tx digest + a Suiscan URL, surfaced as
structured JSON.

## Config & signer

Reuse the CLI's existing config so there is no new key flow: load
`~/.tai/config.toml` + the 0600 key file written by `tai init`. Network is
testnet (callable package `0xc5d0…a421`, config `0x4a8b…3c50`). If no signer is
configured, read tools work and transact tools return a clear
"run `tai init` / configure a signer" error. A `--key-path` / env override
mirrors the CLI for non-default locations.

## Architecture / components

- `rust/tai-mcp/` (new crate in the workspace):
  - `main.rs` — MCP stdio server bootstrap: load config, build a `tai-core`
    client + signer, register tools, run the stdio JSON-RPC loop.
  - `server.rs` — the MCP server wiring (tool registry, request routing,
    error mapping).
  - `tools/reads.rs`, `tools/trade.rs`, `tools/service.rs`, `tools/launch.rs`,
    `tools/treasury.rs` — each tool: declare its JSON-Schema input, parse args,
    call the matching `tai-core` client method, shape the JSON result. No
    on-chain logic here — pure adaptation over `tai-core`.
- **MCP SDK:** use `rmcp` (the community Rust MCP SDK) for the stdio server.
  Fallback if it proves immature for stdio: a minimal hand-rolled JSON-RPC
  over stdio loop (MCP is JSON-RPC 2.0 over stdio) — the tool logic is
  identical either way, so this choice is isolated to `server.rs`/`main.rs`.
- **Workspace:** add `tai-mcp` as a third member alongside `tai-core` /
  `tai-cli`; it depends on `tai-core` by path + version, same as `tai-cli`.

## Distribution & onboarding

- Extend the existing crates.io publish workflow (`.github/workflows/
  publish.yml`) to also publish `tai-mcp` after `tai-core`.
- A docs page ("Use Tai from your agent — MCP") with a copy-paste setup recipe
  per runtime:
  - **Claude Code:** `claude mcp add tai -- tai-mcp` (or `.mcp.json` snippet).
  - **Codex CLI:** `mcp_servers.tai` entry in `~/.codex/config.toml`.
  - **Hermes:** connect-an-MCP-server config pointing at the `tai-mcp` binary.
  - **OpenClaw:** MCP integration entry pointing at the `tai-mcp` binary.
- Prerequisite notes: `cargo install tai-mcp`; `tai init` to set up a signer;
  `sui` CLI on PATH only if using `tai_launch`.

## Error handling

- No signer configured → transact tools return a structured error telling the
  user to run `tai init`; read tools unaffected.
- RPC / signing failures → surface `tai-core`'s error message in the MCP tool
  error.
- `tai_launch` without `sui` on PATH → clear actionable error (same as CLI).
- Invalid/oversized args (bad agent id, non-decimal amount, dispute window
  below the 5-min floor) → validation error before any network call.
- Amounts as strings throughout to avoid float precision loss.

## Testing

- **Unit:** per-tool arg parsing/validation and output shaping, with the
  `tai-core` client mocked/trait-abstracted — no network. Cover the
  no-signer-on-transact error path and amount-string parsing.
- **Integration:** a couple of `#[ignore]`d live-testnet tests (e.g.
  `tai_agent_show` on Larry, `tai_quote`) mirroring `tai-core`'s existing
  ignored integration tests.
- **Manual:** configure `tai-mcp` in Claude Code; call `tai_agent_show larry`
  and `tai_quote`; then a real `tai_buy` (small) with a funded testnet key;
  confirm the digest on Suiscan. Repeat the read calls from one other runtime
  (Codex) to confirm the stdio server is runtime-agnostic.

## Mainnet guardrail (recorded; not built in this spec)

Before `tai-mcp` is pointed at mainnet: replace the full-authority signer with
an OperatorCap-scoped key, and add a per-call max + rolling daily cap + payee
allowlist + an explicit confirmation gate on every spending tool. This mirrors
Tai's on-chain OperatorCap philosophy and the project-wide rule that mainnet is
gated on hardening + audit.

## Phasing

- **Phase 1 (this spec):** read tools + transact tools + config/signer reuse +
  distribution + per-runtime recipes + tests.
- **Phase 2 (next spec):** earn/escrow tools (`tai_work_orders_for_me`,
  `tai_work_accept`, `tai_work_submit_receipt`) so an agent operated via MCP can
  take and deliver escrow jobs. Sync-instant earn remains the HTTP fulfillment
  adapter.
