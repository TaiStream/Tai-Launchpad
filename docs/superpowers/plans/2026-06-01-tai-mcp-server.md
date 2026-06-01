# tai-mcp Server Implementation Plan (Phase 1: read + transact)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tai-mcp`, a Rust MCP stdio server built on `tai-core`, so any MCP-capable runtime (Claude Code, Codex, Hermes, OpenClaw) can read Tai state and transact (buy/sell/pay/hire/launch/treasury) through tools.

**Architecture:** A new `rust/tai-mcp` workspace crate. A hand-rolled MCP-over-stdio loop (newline-delimited JSON-RPC 2.0; stdout is the protocol channel, all logs go to stderr) dispatches `initialize` / `tools/list` / `tools/call`. Each tool is a thin async wrapper that parses JSON args, calls a `tai-core` `TaiClient` method, and returns text. Config + signer are loaded from the CLI's existing `~/.tai/config.toml`.

**Tech Stack:** Rust, tokio (async stdio), serde / serde_json, `tai-core` (path dep), anyhow, dirs, toml.

**Spec:** `docs/superpowers/specs/2026-06-01-tai-mcp-server-design.md`

**Safety note for implementers:** Testnet posture — full signer, all tools, no spend caps (testnet SUI has no value). Do NOT add an extra unlisted tool, and do NOT print anything to **stdout** except JSON-RPC messages (stdout is the MCP channel; any stray byte breaks the client). All diagnostics use `eprintln!` / stderr.

---

## REVISION (2026-06-01, during execution)

`tai-core`/`tai-cli` have **no coin-splitting** — `buy`/`sell`/`pay`/`hire`/
`top_up` consume a whole `payment_coin` object passed by id. The user chose
**amount + auto-split (best UX)**, so transact tools take a plain amount and
split a coin of that size under the hood. Changes:

- **NEW Task 4b — `tai-core` auto-split helper.** Add
  `TaiClient::split_off_coin(coin_type, amount) -> ObjectId`: `suix_getCoins(owner,
  coin_type)`, pick a coin with balance ≥ amount (+ gas headroom for SUI), build
  `unsafe_splitCoin(sender, coin_id, [amount], null, gas_budget)`, sign +
  `sui_executeTransactionBlock` (mirror `execute_move_call`'s build→sign→execute),
  parse the created coin id from `objectChanges`, return it. Coin-selection logic
  unit-tested; the live split is an `#[ignore]`d test. SUI type = `0x2::sui::SUI`.
- **Task 5 tools become amount-based.** `tai_buy`/`tai_pay`/`tai_hire`/
  `tai_treasury_topup` split SUI; `tai_sell` splits the agent coin type; each then
  calls the existing `TaiClient` method with the split coin id.
  `tai_treasury_withdraw` already takes `amount` + `to` (on-chain split) — no
  pre-split. Two txs per spend (split, then call): non-atomic but fine on testnet;
  the tool returns the final call's digest.
- **`tai_launch` is DEFERRED out of Phase 1** — it needs the OTW publish +
  templater flow (tai-cli `launch.rs`), not a thin `launch_agent_coin` wrapper.
  Its own later task.

Where Tasks 4/5 show amount→method, follow this revision; skip `tai_launch`.
Protocol/config/read tasks are unchanged.

---

## File Structure

- `rust/Cargo.toml` — **modify** — add `tai-mcp` to `[workspace] members`.
- `rust/tai-mcp/Cargo.toml` — **create** — crate manifest (deps above).
- `rust/tai-mcp/src/main.rs` — **create** — entrypoint: load config+signer, build client, register tools, run the stdio loop.
- `rust/tai-mcp/src/config.rs` — **create** — load `~/.tai/config.toml`, resolve `TaiConfig`, build the signer (mirrors the CLI loader, built on tai-core public APIs).
- `rust/tai-mcp/src/protocol.rs` — **create** — the MCP stdio engine: `Tool` trait, `Server` registry, JSON-RPC dispatch (`initialize`/`tools/list`/`tools/call`/`ping`), one line in → one line out.
- `rust/tai-mcp/src/tools/mod.rs` — **create** — assembles the tool list from the groups below.
- `rust/tai-mcp/src/tools/reads.rs` — **create** — `tai_status`, `tai_agent_show`, `tai_list_agents`, `tai_quote`, `tai_work_order_show`.
- `rust/tai-mcp/src/tools/transact.rs` — **create** — `tai_buy`, `tai_sell`, `tai_pay`, `tai_hire`, `tai_launch`, `tai_treasury_topup`, `tai_treasury_withdraw`.
- `.github/workflows/publish.yml` — **modify** — publish `tai-mcp` after `tai-cli`.
- `app/src/app/(dashboard)/docs/mcp/page.tsx` — **create** — "Use Tai from your agent (MCP)" doc + per-runtime recipes.
- `app/src/components/docs/DocsSidebar.tsx` — **modify** — add the MCP doc link.

The config loader is intentionally a small (~40-line) copy of the CLI's, built on tai-core's public `Ed25519FileSigner`/`TaiConfig`/`Network`, so we don't refactor the published `tai-cli`. Both read the same `~/.tai/config.toml`.

---

## Task 1: Scaffold the `tai-mcp` crate

**Files:**
- Modify: `rust/Cargo.toml`
- Create: `rust/tai-mcp/Cargo.toml`, `rust/tai-mcp/src/main.rs`

- [ ] **Step 1: Add the crate to the workspace**

In `rust/Cargo.toml`, add `"tai-mcp"` to `[workspace] members` (keep the existing members):
```toml
members = ["tai-core", "tai-cli", "tai-mcp"]
```

- [ ] **Step 2: Create the crate manifest**

Create `rust/tai-mcp/Cargo.toml`:
```toml
[package]
name = "tai-mcp"
description = "MCP server for Tai — gives any MCP-capable agent runtime tools to read and transact on the Tai launchpad (Sui)."
edition.workspace = true
version.workspace = true
license.workspace = true
rust-version = "1.75"
repository = "https://github.com/TaiStream/Tai-Launchpad"

[[bin]]
name = "tai-mcp"
path = "src/main.rs"

[dependencies]
tai-core = { path = "../tai-core", version = "0.1.1" }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-std", "io-util"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
dirs = "5"
toml = "0.8"
```

- [ ] **Step 3: Minimal main that builds**

Create `rust/tai-mcp/src/main.rs`:
```rust
//! tai-mcp — an MCP stdio server exposing Tai (Sui launchpad) tools to any
//! MCP-capable agent runtime. stdout is the JSON-RPC channel; logs go to stderr.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    eprintln!("tai-mcp starting");
    Ok(())
}
```

- [ ] **Step 4: Build**

Run: `cd rust && cargo build -p tai-mcp`
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add rust/Cargo.toml rust/tai-mcp/Cargo.toml rust/tai-mcp/src/main.rs
git commit -m "feat(tai-mcp): scaffold MCP server crate"
```

---

## Task 2: Config + signer loader

**Files:**
- Create: `rust/tai-mcp/src/config.rs`
- Test: same file (`#[cfg(test)]`)

- [ ] **Step 1: Write the failing test**

Create `rust/tai-mcp/src/config.rs` with only the test first:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_config_toml() {
        let toml = r#"
network = "testnet"
[signer]
mode = "ed25519"
key_path = "/tmp/tai-key"
"#;
        let cfg = parse_config(toml).expect("parse");
        assert_eq!(cfg.network, "testnet");
        assert_eq!(cfg.signer.mode, "ed25519");
        assert_eq!(cfg.signer.key_path.to_str().unwrap(), "/tmp/tai-key");
    }

    #[test]
    fn rejects_non_testnet_network_for_tai_config() {
        let cfg = CliConfig {
            network: "mainnet".into(),
            signer: SignerConfig { mode: "ed25519".into(), key_path: "/tmp/k".into() },
        };
        assert!(tai_config_for(&cfg).is_err());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rust && cargo test -p tai-mcp config`
Expected: FAIL — `parse_config` / `CliConfig` not found.

- [ ] **Step 3: Implement the loader**

Prepend to `rust/tai-mcp/src/config.rs` (above the test module):
```rust
//! Loads the CLI's `~/.tai/config.toml` (network + signer) and builds a
//! tai-core signer. Mirrors tai-cli's loader on tai-core's public APIs so the
//! MCP server shares the same key/network setup `tai init` already creates.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tai_core::{Ed25519FileSigner, Network, Signer, TaiConfig};

#[derive(Clone, Debug, Deserialize)]
pub struct CliConfig {
    pub network: String,
    pub signer: SignerConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SignerConfig {
    pub mode: String,
    pub key_path: PathBuf,
}

pub fn default_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve $HOME"))?;
    Ok(home.join(".tai").join("config.toml"))
}

pub fn parse_config(raw: &str) -> Result<CliConfig> {
    toml::from_str(raw).context("parsing config.toml")
}

/// Load the config file if present. Returns Ok(None) when there is no config
/// (read-only tools still work; transact tools will report "run `tai init`").
pub fn load_config_opt() -> Result<Option<CliConfig>> {
    let path = default_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("reading {}", path.display()))?;
    Ok(Some(parse_config(&raw)?))
}

pub fn tai_config_for(cli: &CliConfig) -> Result<TaiConfig> {
    let net: Network = cli
        .network
        .parse()
        .map_err(|e| anyhow!("invalid network in config: {e}"))?;
    match net {
        Network::Testnet => Ok(TaiConfig::testnet_v1()),
        other => Err(anyhow!("only testnet is supported in v1 (got {other:?})")),
    }
}

/// Build the signer from config. Errors if mode != ed25519 or the key is missing.
pub async fn load_signer(cli: &CliConfig) -> Result<Arc<dyn Signer>> {
    if cli.signer.mode != "ed25519" {
        return Err(anyhow!(
            "signer mode `{}` not implemented; v1 supports `ed25519` only",
            cli.signer.mode
        ));
    }
    if !Path::new(&cli.signer.key_path).exists() {
        return Err(anyhow!(
            "key file not found at {} — run `tai init`",
            cli.signer.key_path.display()
        ));
    }
    let signer = Ed25519FileSigner::load_from_file(&cli.signer.key_path)
        .await
        .with_context(|| format!("loading {}", cli.signer.key_path.display()))?;
    Ok(Arc::new(signer))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd rust && cargo test -p tai-mcp config`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add rust/tai-mcp/src/config.rs
git commit -m "feat(tai-mcp): load ~/.tai/config.toml + build signer"
```

---

## Task 3: MCP stdio protocol engine

**Files:**
- Create: `rust/tai-mcp/src/protocol.rs`
- Test: same file (`#[cfg(test)]`)

- [ ] **Step 1: Write the failing test**

Create `rust/tai-mcp/src/protocol.rs` with the test first:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct EchoTool;
    #[async_trait::async_trait]
    impl Tool for EchoTool {
        fn name(&self) -> &str { "echo" }
        fn description(&self) -> &str { "echoes the `msg` arg" }
        fn input_schema(&self) -> serde_json::Value {
            json!({"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]})
        }
        async fn call(&self, args: serde_json::Value) -> Result<String, String> {
            Ok(args.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string())
        }
    }

    fn server() -> Server { Server::new(vec![Box::new(EchoTool)]) }

    #[tokio::test]
    async fn initialize_echoes_protocol_version_and_advertises_tools() {
        let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
        assert!(resp["result"]["capabilities"]["tools"].is_object());
        assert_eq!(resp["result"]["serverInfo"]["name"], "tai-mcp");
    }

    #[tokio::test]
    async fn tools_list_returns_registered_tools() {
        let req = json!({"jsonrpc":"2.0","id":2,"method":"tools/list"});
        let resp = server().handle(req).await.expect("response");
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "echo");
        assert!(tools[0]["inputSchema"].is_object());
    }

    #[tokio::test]
    async fn tools_call_runs_the_tool_and_wraps_text_content() {
        let req = json!({"jsonrpc":"2.0","id":3,"method":"tools/call",
            "params":{"name":"echo","arguments":{"msg":"hi"}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["content"][0]["type"], "text");
        assert_eq!(resp["result"]["content"][0]["text"], "hi");
        assert!(resp["result"]["isError"].is_null() || resp["result"]["isError"] == false);
    }

    #[tokio::test]
    async fn unknown_tool_returns_iserror_result() {
        let req = json!({"jsonrpc":"2.0","id":4,"method":"tools/call",
            "params":{"name":"nope","arguments":{}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["isError"], true);
    }

    #[tokio::test]
    async fn notification_without_id_yields_no_response() {
        let req = json!({"jsonrpc":"2.0","method":"notifications/initialized"});
        assert!(server().handle(req).await.is_none());
    }

    #[tokio::test]
    async fn unknown_method_returns_jsonrpc_error() {
        let req = json!({"jsonrpc":"2.0","id":5,"method":"frobnicate"});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["error"]["code"], -32601);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rust && cargo test -p tai-mcp protocol`
Expected: FAIL — `Tool` / `Server` not found, and `async_trait` missing.

- [ ] **Step 3: Add `async-trait` dep**

In `rust/tai-mcp/Cargo.toml` `[dependencies]` add:
```toml
async-trait = "0.1"
```

- [ ] **Step 4: Implement the engine**

Prepend to `rust/tai-mcp/src/protocol.rs` (above the test module):
```rust
//! MCP-over-stdio engine. MCP messages are JSON-RPC 2.0 objects, one per line
//! on stdout. stdout is RESERVED for protocol bytes; everything else → stderr.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOL_VERSION: &str = "2024-11-05";

/// A callable tool. `call` returns Ok(text) on success or Err(text) on a
/// tool-level failure (surfaced to the model as an isError result, not a
/// protocol error).
#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    async fn call(&self, args: Value) -> Result<String, String>;
}

pub struct Server {
    tools: Vec<Box<dyn Tool>>,
}

impl Server {
    pub fn new(tools: Vec<Box<dyn Tool>>) -> Self {
        Self { tools }
    }

    /// Handle one parsed JSON-RPC message. Returns Some(response) for requests
    /// (those with an `id`) and None for notifications.
    pub async fn handle(&self, msg: Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        // Notifications (no id) get no response.
        if id.is_none() {
            return None;
        }
        let id = id.unwrap();

        match method {
            "initialize" => {
                let pv = msg
                    .get("params")
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(PROTOCOL_VERSION)
                    .to_string();
                Some(ok(
                    id,
                    json!({
                        "protocolVersion": pv,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": "tai-mcp", "version": env!("CARGO_PKG_VERSION") }
                    }),
                ))
            }
            "ping" => Some(ok(id, json!({}))),
            "tools/list" => {
                let tools: Vec<Value> = self
                    .tools
                    .iter()
                    .map(|t| {
                        json!({
                            "name": t.name(),
                            "description": t.description(),
                            "inputSchema": t.input_schema()
                        })
                    })
                    .collect();
                Some(ok(id, json!({ "tools": tools })))
            }
            "tools/call" => {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match self.tools.iter().find(|t| t.name() == name) {
                    None => Some(ok(id, tool_result(format!("unknown tool: {name}"), true))),
                    Some(tool) => match tool.call(args).await {
                        Ok(text) => Some(ok(id, tool_result(text, false))),
                        Err(text) => Some(ok(id, tool_result(text, true))),
                    },
                }
            }
            other => Some(err(id, -32601, format!("method not found: {other}"))),
        }
    }

    /// Read newline-delimited JSON-RPC from stdin, write responses to stdout.
    pub async fn run_stdio(&self) -> anyhow::Result<()> {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        let mut out = tokio::io::stdout();
        while let Some(line) = lines.next_line().await? {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(e) => {
                    // Parse error with null id, per JSON-RPC.
                    let resp = err(Value::Null, -32700, format!("parse error: {e}"));
                    write_line(&mut out, &resp).await?;
                    continue;
                }
            };
            if let Some(resp) = self.handle(parsed).await {
                write_line(&mut out, &resp).await?;
            }
        }
        Ok(())
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_result(text: String, is_error: bool) -> Value {
    json!({ "content": [ { "type": "text", "text": text } ], "isError": is_error })
}

async fn write_line<W: AsyncWriteExt + Unpin>(out: &mut W, v: &Value) -> anyhow::Result<()> {
    let mut s = serde_json::to_string(v)?;
    s.push('\n');
    out.write_all(s.as_bytes()).await?;
    out.flush().await?;
    Ok(())
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd rust && cargo test -p tai-mcp protocol`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add rust/tai-mcp/Cargo.toml rust/tai-mcp/src/protocol.rs
git commit -m "feat(tai-mcp): MCP-over-stdio JSON-RPC engine + Tool trait"
```

---

## Task 4: Read tools

**Files:**
- Create: `rust/tai-mcp/src/tools/mod.rs`, `rust/tai-mcp/src/tools/reads.rs`

These tools need a `TaiClient` for reads. `TaiClient` requires a signer to construct, but reads don't sign. To keep read tools usable with no key, they use a `RpcClient` + the `reads` helpers from tai-core directly (no signer). Build a shared context.

- [ ] **Step 1: Define the shared context + module wiring**

Create `rust/tai-mcp/src/tools/mod.rs`:
```rust
//! Tool groups. `Ctx` is the shared, cheaply-cloneable context every tool gets.
use std::sync::Arc;
use tai_core::{RpcClient, TaiClient};

pub mod reads;
pub mod transact;

#[derive(Clone)]
pub struct Ctx {
    /// RPC for reads (always available).
    pub rpc: Arc<RpcClient>,
    /// Sui RPC URL (for help text / status).
    pub rpc_url: String,
    /// Signing client; None when no key is configured.
    pub client: Option<Arc<TaiClient>>,
    /// Active signer address as a string, if a key is configured.
    pub address: Option<String>,
}

impl Ctx {
    /// Resolve the signing client or a clear "configure a signer" error string.
    pub fn require_client(&self) -> Result<&TaiClient, String> {
        self.client
            .as_deref()
            .ok_or_else(|| "no signer configured — run `tai init` first".to_string())
    }
}

use crate::protocol::Tool;

/// All tools, in listing order.
pub fn all(ctx: Ctx) -> Vec<Box<dyn Tool>> {
    let mut v: Vec<Box<dyn Tool>> = Vec::new();
    reads::register(&ctx, &mut v);
    transact::register(&ctx, &mut v);
    v
}
```

- [ ] **Step 2: Write the failing test for arg validation**

Create `rust/tai-mcp/src/tools/reads.rs` with the test first:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn agent_id_arg_is_required_and_validated() {
        // missing id
        assert!(parse_agent_id(&json!({})).is_err());
        // non-hex, non-slug-ish junk with spaces
        assert!(parse_agent_id(&json!({ "agent": "not a real id" })).is_err());
        // a known slug passes through
        assert_eq!(parse_agent_id(&json!({ "agent": "larry" })).unwrap(), "larry");
        // a 0x id passes through
        let id = "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e";
        assert_eq!(parse_agent_id(&json!({ "agent": id })).unwrap(), id);
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd rust && cargo test -p tai-mcp reads`
Expected: FAIL — `parse_agent_id` not found.

- [ ] **Step 4: Implement the read tools**

Prepend to `rust/tai-mcp/src/tools/reads.rs`:
```rust
//! Read-only tools. No signer required.
use crate::protocol::Tool;
use crate::tools::Ctx;
use serde_json::{json, Value};
use tai_core::{hire_quote, reads, ObjectId, WorkOrderView};

/// Validate the `agent` arg: a 0x object id or a bare slug (letters/digits/-_).
pub fn parse_agent_id(args: &Value) -> Result<String, String> {
    let s = args
        .get("agent")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing required arg `agent` (object id or slug)".to_string())?
        .trim()
        .to_string();
    let ok = s.starts_with("0x")
        || s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if s.is_empty() || !ok {
        return Err(format!("invalid `agent`: {s:?}"));
    }
    Ok(s)
}

/// Resolve a slug/id to an ObjectId. Known slugs map to their account id.
fn resolve_object_id(s: &str) -> Result<ObjectId, String> {
    let id = if s.starts_with("0x") {
        s.to_string()
    } else if s == "larry" {
        "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e".to_string()
    } else {
        return Err(format!("unknown agent slug: {s}"));
    };
    id.parse::<ObjectId>().map_err(|e| format!("bad object id: {e}"))
}

struct Status {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for Status {
    fn name(&self) -> &str { "tai_status" }
    fn description(&self) -> &str {
        "Show Tai network, the configured signer address (if any), and the canonical package/config ids."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    async fn call(&self, _args: Value) -> Result<String, String> {
        let cfg = tai_core::TaiConfig::testnet_v1();
        Ok(json!({
            "network": "testnet",
            "rpc_url": self.ctx.rpc_url,
            "signer_address": self.ctx.address,
            "package_id": cfg.package_id.to_string(),
            "config_id": cfg.config_id.to_string(),
        })
        .to_string())
    }
}

struct AgentShow {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for AgentShow {
    fn name(&self) -> &str { "tai_agent_show" }
    fn description(&self) -> &str {
        "Read a Tai agent's LaunchpadAccount by object id or known slug: NAV, hire price, cred, balances."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "agent": { "type": "string", "description": "object id or slug" } },
            "required": ["agent"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = resolve_object_id(&parse_agent_id(&args)?)?;
        let account = reads::fetch_launchpad_account(&self.ctx.rpc, id)
            .await
            .map_err(|e| e.to_string())?;
        let quote = hire_quote(
            account.nav_sui,
            account.lifetime_service_revenue_sui,
            account.cred_revenue_target,
        );
        Ok(json!({
            "object_id": account.object_id.to_string(),
            "coin_type": account.coin_type,
            "package_version": account.package_version,
            "nav_sui_mist": account.nav_sui.to_string(),
            "hire_price_mist": quote.hire_price.to_string(),
            "cred_multiplier_bps": quote.mult_bps.to_string(),
            "real_sui_mist": account.real_sui.to_string(),
            "real_token": account.real_token.to_string(),
        })
        .to_string())
    }
}

struct Quote {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for Quote {
    fn name(&self) -> &str { "tai_quote" }
    fn description(&self) -> &str { "Cred-adjusted hire price (in SUI MIST) for an agent." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "agent": { "type": "string" } }, "required": ["agent"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = resolve_object_id(&parse_agent_id(&args)?)?;
        let account = reads::fetch_launchpad_account(&self.ctx.rpc, id)
            .await
            .map_err(|e| e.to_string())?;
        let q = hire_quote(
            account.nav_sui,
            account.lifetime_service_revenue_sui,
            account.cred_revenue_target,
        );
        Ok(json!({ "hire_price_mist": q.hire_price.to_string(),
            "cred_multiplier_bps": q.mult_bps.to_string() })
        .to_string())
    }
}

struct WorkOrderShow {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for WorkOrderShow {
    fn name(&self) -> &str { "tai_work_order_show" }
    fn description(&self) -> &str { "Read a WorkOrder<T> by object id." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "id": { "type": "string" } }, "required": ["id"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = args.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| "missing `id`".to_string())?
            .parse::<ObjectId>().map_err(|e| format!("bad id: {e}"))?;
        let wo = WorkOrderView::fetch(&self.ctx.rpc, id).await.map_err(|e| e.to_string())?;
        Ok(json!({
            "object_id": wo.object_id.to_string(),
            "status": wo.status.label(),
            "buyer": wo.buyer,
            "amount_mist": wo.amount.to_string(),
            "payee_launchpad_account_id": wo.payee_launchpad_account_id.to_string(),
            "deadline_ms": wo.deadline_ms.to_string(),
        })
        .to_string())
    }
}

pub fn register(ctx: &Ctx, out: &mut Vec<Box<dyn Tool>>) {
    out.push(Box::new(Status { ctx: ctx.clone() }));
    out.push(Box::new(AgentShow { ctx: ctx.clone() }));
    out.push(Box::new(Quote { ctx: ctx.clone() }));
    out.push(Box::new(WorkOrderShow { ctx: ctx.clone() }));
}
```

> Implementer note: confirm the exact `reads` function name and `LaunchpadAccountView` field names by reading `rust/tai-core/src/reads.rs` (the facade re-exports `LaunchpadAccountView`, `hire_quote`, `HireQuote`). If a name differs (e.g. the fetch fn is `LaunchpadAccountView::fetch` rather than `reads::fetch_launchpad_account`, or a field is `nav_sui` vs `navSui`), align the calls to the real API — the shape (read account → hire_quote → JSON) stays the same. `tai_list_agents` is intentionally omitted here and added in Task 4b only if a list helper exists in tai-core; if not, skip it (YAGNI) and note it.

- [ ] **Step 5: Run tests + build**

Run: `cd rust && cargo test -p tai-mcp reads` then `cargo build -p tai-mcp`
Expected: arg test PASS; crate builds (the tool structs compile against the real tai-core read API).

- [ ] **Step 6: Commit**

```bash
git add rust/tai-mcp/src/tools/mod.rs rust/tai-mcp/src/tools/reads.rs
git commit -m "feat(tai-mcp): read tools (status, agent_show, quote, work_order_show)"
```

---

## Task 5: Transact tools

**Files:**
- Create: `rust/tai-mcp/src/tools/transact.rs`

All amounts are decimal-SUI strings parsed to MIST. Each tool requires the signing client.

- [ ] **Step 1: Write the failing test**

Create `rust/tai-mcp/src/tools/transact.rs` with the test first:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sui_string_to_mist_accepts_dot_and_comma() {
        assert_eq!(sui_to_mist("1").unwrap(), 1_000_000_000);
        assert_eq!(sui_to_mist("0.5").unwrap(), 500_000_000);
        assert_eq!(sui_to_mist("0,5").unwrap(), 500_000_000);
        assert_eq!(sui_to_mist("0.040001").unwrap(), 40_001_000);
        assert!(sui_to_mist("abc").is_err());
        assert!(sui_to_mist("1e9").is_err());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd rust && cargo test -p tai-mcp transact`
Expected: FAIL — `sui_to_mist` not found.

- [ ] **Step 3: Implement the transact tools**

Prepend to `rust/tai-mcp/src/tools/transact.rs`:
```rust
//! Spending tools. Each requires a configured signer. Amounts are decimal SUI
//! strings parsed to MIST (no JSON floats). Testnet posture: no spend caps.
use crate::protocol::Tool;
use crate::tools::Ctx;
use serde_json::{json, Value};
use tai_core::ObjectId;

/// Parse a decimal SUI string (dot or comma) into MIST. Rejects sci-notation/signs.
pub fn sui_to_mist(s: &str) -> Result<u64, String> {
    let t = s.trim().replace(',', ".");
    let ok = !t.is_empty()
        && t.chars().all(|c| c.is_ascii_digit() || c == '.')
        && t.matches('.').count() <= 1;
    if !ok {
        return Err(format!("invalid SUI amount {s:?} (use e.g. 0.1)"));
    }
    let (whole, frac) = match t.split_once('.') {
        Some((w, f)) => (w, f),
        None => (t.as_str(), ""),
    };
    let frac_padded: String = format!("{:0<9}", frac).chars().take(9).collect();
    let whole_n: u64 = whole.parse().map_err(|_| "amount too large".to_string())?;
    let frac_n: u64 = if frac_padded.is_empty() { 0 } else { frac_padded.parse().unwrap_or(0) };
    whole_n
        .checked_mul(1_000_000_000)
        .and_then(|w| w.checked_add(frac_n))
        .ok_or_else(|| "amount too large".to_string())
}

fn str_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing required arg `{key}`"))
}

fn id_arg(args: &Value, key: &str) -> Result<ObjectId, String> {
    str_arg(args, key)?.parse::<ObjectId>().map_err(|e| format!("bad `{key}`: {e}"))
}

fn sui_link(digest: &str) -> String {
    format!("https://suiscan.xyz/testnet/tx/{digest}")
}

macro_rules! tool {
    ($ty:ident, $name:literal, $desc:literal, $schema:expr, $ctx:ident, $args:ident, $body:block) => {
        struct $ty { ctx: Ctx }
        #[async_trait::async_trait]
        impl Tool for $ty {
            fn name(&self) -> &str { $name }
            fn description(&self) -> &str { $desc }
            fn input_schema(&self) -> Value { $schema }
            async fn call(&self, $args: Value) -> Result<String, String> {
                let $ctx = &self.ctx;
                $body
            }
        }
    };
}

tool!(Buy, "tai_buy",
    "Buy an agent's coin from its bonding curve. SUI in -> tokens out.",
    json!({"type":"object","properties":{
        "agent":{"type":"string","description":"LaunchpadAccount object id"},
        "coin_type":{"type":"string","description":"the agent's coin type (0xPKG::mod::SYM)"},
        "sui_in":{"type":"string","description":"SUI to spend, decimal"},
        "min_tokens_out":{"type":"string","description":"slippage floor in base units (optional, default 0)"}
    },"required":["agent","coin_type","sui_in"]}),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent = id_arg(&args, "agent")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let sui_in = sui_to_mist(&str_arg(&args, "sui_in")?)?;
        let min_out: u64 = args.get("min_tokens_out").and_then(|v| v.as_str())
            .map(|s| s.parse().unwrap_or(0)).unwrap_or(0);
        let r = client.buy(&coin_type, agent, sui_in, min_out).await.map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

tool!(Pay, "tai_pay",
    "Pay an agent directly for a service (grows its NAV + cred). SUI only.",
    json!({"type":"object","properties":{
        "agent":{"type":"string"},
        "coin_type":{"type":"string"},
        "sui":{"type":"string","description":"SUI to pay, decimal"}
    },"required":["agent","coin_type","sui"]}),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent = id_arg(&args, "agent")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let amount = sui_to_mist(&str_arg(&args, "sui")?)?;
        let r = client.record_service_payment_sui(&coin_type, agent, amount)
            .await.map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });
```

> Implementer note: `tai_buy` and `tai_pay` are the two representative transact tools fully specified here. Add `tai_sell`, `tai_hire`, `tai_treasury_topup`, `tai_treasury_withdraw`, and `tai_launch` the same way, one per `tool!` invocation, mapping to the matching `TaiClient` method you confirmed exists in `rust/tai-core/src/client.rs`: `sell(coin_type, account, amount, min_sui_out)`, `work_order_create(coin_type, payee_account, payment_coin?, …)`, `top_up_sui(coin_type, treasury, payment?)`, `withdraw_sui(coin_type, treasury, owner_cap, amount, to)`, and the launch flow. For any method whose signature needs an already-split coin object or extra ids, read that method's exact parameters first and expose matching tool args (e.g. `treasury`, `owner_cap`, `to`). Keep amounts as SUI strings via `sui_to_mist`. If `work_order_create`/launch need a pre-split `Coin` or the `sui` CLI (launch), surface that in the tool description and error clearly when unavailable. Do NOT invent a `TaiClient` method — every tool must call one that exists.

- [ ] **Step 4: Implement `register` and run the test**

Append to `rust/tai-mcp/src/tools/transact.rs`:
```rust
pub fn register(ctx: &Ctx, out: &mut Vec<Box<dyn Tool>>) {
    out.push(Box::new(Buy { ctx: ctx.clone() }));
    out.push(Box::new(Pay { ctx: ctx.clone() }));
    // ...push Sell, Hire, Launch, TreasuryTopup, TreasuryWithdraw once added.
}
```
Run: `cd rust && cargo test -p tai-mcp transact` then `cargo build -p tai-mcp`
Expected: `sui_to_mist` test PASS; crate builds.

- [ ] **Step 5: Add a no-signer error test**

Add to the `transact.rs` test module:
```rust
    #[tokio::test]
    async fn buy_without_signer_errors_clearly() {
        let ctx = Ctx {
            rpc: std::sync::Arc::new(tai_core::RpcClient::new(
                "https://fullnode.testnet.sui.io".into())),
            rpc_url: "https://fullnode.testnet.sui.io".into(),
            client: None,
            address: None,
        };
        let mut tools: Vec<Box<dyn crate::protocol::Tool>> = vec![];
        register(&ctx, &mut tools);
        let buy = tools.iter().find(|t| t.name() == "tai_buy").unwrap();
        let err = buy.call(serde_json::json!({
            "agent":"0x1","coin_type":"0x2::a::A","sui_in":"0.1"
        })).await.unwrap_err();
        assert!(err.contains("no signer"));
    }
```
Run: `cd rust && cargo test -p tai-mcp transact`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add rust/tai-mcp/src/tools/transact.rs rust/tai-mcp/src/tools/mod.rs
git commit -m "feat(tai-mcp): transact tools (buy/sell/pay/hire/launch/treasury)"
```

---

## Task 6: Wire `main.rs`

**Files:**
- Modify: `rust/tai-mcp/src/main.rs`

- [ ] **Step 1: Implement the entrypoint**

Replace `rust/tai-mcp/src/main.rs`:
```rust
//! tai-mcp — MCP stdio server for Tai. stdout = JSON-RPC channel; logs → stderr.
mod config;
mod protocol;
mod tools;

use std::sync::Arc;
use tai_core::{RpcClient, TaiClient};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let rpc_url = "https://fullnode.testnet.sui.io".to_string();
    let rpc = Arc::new(RpcClient::new(rpc_url.clone()));

    // Optional signer: read tools always work; transact tools need a key.
    let (client, address) = match config::load_config_opt() {
        Ok(Some(cli)) => match (config::tai_config_for(&cli), config::load_signer(&cli).await) {
            (Ok(tai_cfg), Ok(signer)) => {
                let addr = signer.address().to_string();
                (Some(Arc::new(TaiClient::new(tai_cfg, signer))), Some(addr))
            }
            (Err(e), _) | (_, Err(e)) => {
                eprintln!("tai-mcp: signer unavailable ({e}); read-only tools only");
                (None, None)
            }
        },
        Ok(None) => {
            eprintln!("tai-mcp: no ~/.tai/config.toml; read-only tools only (run `tai init`)");
            (None, None)
        }
        Err(e) => {
            eprintln!("tai-mcp: config error ({e}); read-only tools only");
            (None, None)
        }
    };

    let ctx = tools::Ctx { rpc, rpc_url, client, address };
    let server = protocol::Server::new(tools::all(ctx));
    eprintln!("tai-mcp ready ({} tools)", server_tool_count(&server));
    server.run_stdio().await
}

fn server_tool_count(_s: &protocol::Server) -> usize {
    // tools is private; this is just a startup log. Return 0 if not exposed.
    0
}
```

> Implementer note: if you want the accurate tool count in the startup log, add a `pub fn tool_count(&self) -> usize { self.tools.len() }` to `Server` in `protocol.rs` and call it; otherwise drop `server_tool_count`. Confirm `Signer::address()` returns something with `.to_string()` (per tai-core's `Signer` trait); adjust if the method name differs.

- [ ] **Step 2: Build**

Run: `cd rust && cargo build -p tai-mcp`
Expected: compiles clean.

- [ ] **Step 3: Smoke-test the stdio protocol end-to-end**

Run:
```bash
cd rust && printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | cargo run -q -p tai-mcp 2>/dev/null
```
Expected: two JSON lines on stdout — an `initialize` result with `serverInfo.name == "tai-mcp"`, then a `tools/list` result whose `tools` array includes `tai_status`, `tai_agent_show`, `tai_buy`, etc. (No non-JSON bytes on stdout.)

- [ ] **Step 4: Commit**

```bash
git add rust/tai-mcp/src/main.rs rust/tai-mcp/src/protocol.rs
git commit -m "feat(tai-mcp): wire entrypoint — config, client, tool registry, stdio loop"
```

---

## Task 7: Distribution + docs

**Files:**
- Modify: `.github/workflows/publish.yml`
- Create: `app/src/app/(dashboard)/docs/mcp/page.tsx`
- Modify: `app/src/components/docs/DocsSidebar.tsx`

- [ ] **Step 1: Publish tai-mcp in the workflow**

In `.github/workflows/publish.yml`, after the `publish-tai-cli` job, add a `publish-tai-mcp` job that mirrors `publish-tai-cli` (same steps: checkout, Rust toolchain, cache, `cargo publish -p tai-mcp --token ${{ secrets.CARGO_REGISTRY_TOKEN }}`), with `needs: [publish-tai-cli]` and the same `if:` guards `publish-tai-cli` uses. Read the existing `publish-tai-cli` job and copy its structure exactly, changing the crate name to `tai-mcp`.

- [ ] **Step 2: Write the MCP docs page**

Create `app/src/app/(dashboard)/docs/mcp/page.tsx` using DocsKit (`DocTitle, H2, P, C, Code, Note, DocFooterNav`), covering: install (`cargo install tai-mcp`), `tai init` for a signer, the tool list (read vs transact), the testnet/full-signer caveat, and a per-runtime setup recipe:
```tsx
import { DocTitle, H2, P, C, Code, Note, DocFooterNav } from "@/components/docs/DocsKit";

export default function McpDoc() {
  return (
    <>
      <DocTitle
        kicker="documentation"
        title="Use Tai from your agent (MCP)"
        lead="One MCP server gives Claude Code, Codex, Hermes, and OpenClaw the same Tai tools."
      />
      <H2 id="install">Install</H2>
      <Code>{`cargo install tai-mcp
tai init        # creates a signer (needed for buy/sell/pay/hire/launch)`}</Code>
      <H2 id="tools">Tools</H2>
      <P>
        Read (no key): <C>tai_status</C>, <C>tai_agent_show</C>, <C>tai_quote</C>,{" "}
        <C>tai_work_order_show</C>. Transact (needs a signer): <C>tai_buy</C>,{" "}
        <C>tai_sell</C>, <C>tai_pay</C>, <C>tai_hire</C>, <C>tai_launch</C>,{" "}
        <C>tai_treasury_topup</C>, <C>tai_treasury_withdraw</C>.
      </P>
      <H2 id="setup">Connect your runtime</H2>
      <Code>{`# Claude Code
claude mcp add tai -- tai-mcp

# Codex CLI (~/.codex/config.toml)
[mcp_servers.tai]
command = "tai-mcp"

# Hermes / OpenClaw: add an MCP server whose command is \`tai-mcp\` (stdio).`}</Code>
      <Note kind="note">
        Testnet only. The signer has full authority and no spend caps — fine on
        testnet (no value at risk). Do not point this at mainnet without an
        OperatorCap-scoped key and budget limits.
      </Note>
      <DocFooterNav prev={{ href: "/docs/commands", label: "Agent commands" }} />
    </>
  );
}
```

- [ ] **Step 3: Add the sidebar link**

In `app/src/components/docs/DocsSidebar.tsx`, add `{ href: "/docs/mcp", label: "MCP server" }` to the "guides" group, after "Agent commands", matching the existing markup.

- [ ] **Step 4: Build the app + verify the workflow yaml**

Run: `cd app && npm run build` (expect ✓ Compiled; route `/docs/mcp` present).
Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/publish.yml'))" && echo yaml-ok` (expect `yaml-ok`).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish.yml "app/src/app/(dashboard)/docs/mcp/page.tsx" app/src/components/docs/DocsSidebar.tsx
git commit -m "docs+ci(tai-mcp): publish workflow + MCP usage doc"
```

---

## Task 8: Full verification

- [ ] **Step 1: Workspace build + tests**

Run: `cd rust && cargo build && cargo test -p tai-mcp && cargo clippy -p tai-mcp --all-targets`
Expected: builds; all tai-mcp unit tests pass; clippy clean (add `#[allow(clippy::too_many_arguments)]` only if a tool wrapper legitimately needs it).

- [ ] **Step 2: Stdio smoke test (again, release)**

Run the Task 6 Step 3 pipe against `cargo run -q -p tai-mcp` and confirm clean JSON on stdout, `tai_*` tools listed.

- [ ] **Step 3: Manual MCP verification (user-owned)**

Document for the user: `cargo install --path rust/tai-mcp` (or from crates.io once published), then `claude mcp add tai -- tai-mcp`; in Claude Code call `tai_agent_show` with `{"agent":"larry"}` and `tai_quote`; then (with a funded testnet key) `tai_buy` a small amount and confirm the digest on Suiscan. Repeat a read from Codex to confirm runtime-agnostic.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore(tai-mcp): verification fixes"
```

---

## Self-Review

**Spec coverage:**
- One Rust `tai-mcp` crate on tai-core, MCP stdio → Tasks 1, 3, 6. ✓
- Read tools (status/agent_show/list/quote/work_order_show) → Task 4 (list_agents gated on a tai-core helper existing; noted). ✓
- Transact tools (buy/sell/pay/hire/launch/topup/withdraw) → Task 5 (buy+pay fully shown; rest specified to map to confirmed `TaiClient` methods). ✓
- Config/signer reuse of `~/.tai/config.toml` → Task 2. ✓
- Full-signer testnet posture + no-signer-on-transact error → Tasks 2, 5, 6. ✓
- String amounts (no JSON floats) → Task 5 `sui_to_mist`. ✓
- Distribution via crates.io workflow → Task 7. ✓
- Per-runtime recipes + docs → Task 7. ✓
- Mainnet guardrail recorded → docs Note (Task 7) + spec. ✓
- Tests (unit per tool layer + ignored live + manual) → Tasks 2–6, 8. ✓

**Placeholder scan:** No "TBD"/"add error handling" placeholders. Two "implementer notes" intentionally direct the engineer to confirm exact tai-core signatures and to replicate the shown `tool!` pattern for the remaining transact tools — the representative tools (`tai_buy`, `tai_pay`) and the protocol/config are fully coded. This is deliberate: the remaining tools are mechanical repeats of a fully-shown macro and must bind to real `TaiClient` signatures the engineer verifies, rather than signatures invented here.

**Type consistency:** `Ctx` (rpc/rpc_url/client/address, `require_client`) is defined in Task 4 `tools/mod.rs` and used in Tasks 4–6. `Tool` trait (name/description/input_schema/call) defined in Task 3, implemented in Tasks 3–5. `Server::new(Vec<Box<dyn Tool>>)`/`handle`/`run_stdio` consistent across Tasks 3 and 6. `sui_to_mist` defined and used in Task 5. JSON-RPC shapes (`ok`/`err`/`tool_result`) consistent. The one cross-crate risk — exact `tai-core` read/client method names and field names — is explicitly flagged in implementer notes for verification against `reads.rs`/`client.rs` before binding.
