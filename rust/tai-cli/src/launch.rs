//! `tai launch` — generate a fresh coin module, publish it, then chain
//! `launch_agent_coin<T>` so an agent is launched in one shell command.
//!
//! ## Why subprocess `sui` (not in-process)
//!
//! Publishing a Move package requires a Move compiler. Embedding the
//! compiler in `tai-cli` would blow the binary up by an order of magnitude
//! and pin us to a specific Move toolchain. Instead we shell out to the
//! user's `sui` CLI, which they already need on PATH to do anything else
//! with Sui. The publish step is `sui client publish --json`; we parse
//! the JSON and extract the new package id + freshly-minted TreasuryCap +
//! CoinMetadata ids.
//!
//! ## Template
//!
//! `rust/tai-cli/templates/agent_coin/` holds:
//!   - `Move.toml.tmpl` — package manifest
//!   - `sources/coin.move.tmpl` — coin module with `{{...}}` placeholders
//!
//! Placeholders:
//!   - `{{MODULE_NAME}}`        e.g. "larry_a3f9b2c1"   (lowercase, unique)
//!   - `{{WITNESS_NAME}}`       e.g. "LARRY_A3F9B2C1"   (same uppercased)
//!   - `{{DECIMALS}}`           e.g. "9"
//!   - `{{SYMBOL}}`             user-provided byte string
//!   - `{{NAME_BYTES}}`         user-provided
//!   - `{{DESCRIPTION_BYTES}}`  user-provided
//!   - `{{ICON_URL_BYTES}}`     user-provided
//!
//! All byte fields are raw ASCII — the template emits `b"..."` literals so
//! anything not in the printable ASCII range needs escaping. For v1 we
//! restrict to printable-ASCII inputs and reject otherwise.

use anyhow::{anyhow, Context, Result};
use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use tempfile::TempDir;
use tokio::process::Command;

/// Files copied from the workspace template into a fresh temp dir at launch
/// time. The contents are baked at compile time via `include_str!`, so the
/// CLI binary is self-contained and doesn't need to find the workspace.
const MOVE_TOML_TMPL: &str = include_str!("../templates/agent_coin/Move.toml.tmpl");
const COIN_MOVE_TMPL: &str = include_str!("../templates/agent_coin/sources/coin.move.tmpl");

#[derive(Debug)]
pub struct CoinNames {
    /// Lowercase module name, e.g. `larry_a3f9b2c1`.
    pub module: String,
    /// Uppercase OTW witness name, e.g. `LARRY_A3F9B2C1`.
    pub witness: String,
}

/// Derive a unique pair of (module, witness) names from a user-provided
/// symbol. Appends a short random suffix so two launches of the same
/// symbol don't collide.
pub fn pick_names(symbol_seed: &str) -> CoinNames {
    let mut rng = rand::thread_rng();
    let suffix: String = (0..8)
        .map(|_| {
            let n: u8 = rng.gen_range(0..16);
            std::char::from_digit(n as u32, 16).unwrap()
        })
        .collect();
    let prefix: String = symbol_seed
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .take(12)
        .collect();
    let module_seed = if prefix.is_empty() {
        "agent".to_string()
    } else {
        prefix
    };
    let module = format!("{module_seed}_{suffix}");
    let witness = module.to_uppercase();
    CoinNames { module, witness }
}

/// Render the template into a fresh temp dir. Returns the dir (kept alive
/// via TempDir guard) and the populated `CoinNames`.
/// Render the launch template, baking `caps_recipient` (a 0x-prefixed 32-byte
/// Sui address) as the recipient of the freshly-minted `TreasuryCap<T>` and
/// `CoinMetadata<T>` inside `init`. Pass tai-cli's signer address so the
/// chained `launch_agent_coin<T>` tx can consume them.
pub fn render_template(
    symbol: &str,
    name: &str,
    description: &str,
    icon_url: &str,
    decimals: u8,
    caps_recipient: &str,
) -> Result<(TempDir, CoinNames)> {
    if !ascii_printable(symbol)
        || !ascii_printable(name)
        || !ascii_printable(description)
        || !ascii_printable(icon_url)
    {
        return Err(anyhow!(
            "symbol/name/description/icon_url must be printable ASCII (no quotes)"
        ));
    }
    if symbol.contains('"')
        || name.contains('"')
        || description.contains('"')
        || icon_url.contains('"')
    {
        return Err(anyhow!(
            "byte-string fields must not contain unescaped quotes"
        ));
    }
    if symbol.is_empty() {
        return Err(anyhow!("--symbol cannot be empty"));
    }
    if decimals > 18 {
        return Err(anyhow!("--decimals must be <= 18 (sui convention is 9)"));
    }
    // Strict address-format guard — must be `0x` followed by 64 hex chars.
    let stripped = caps_recipient.strip_prefix("0x").unwrap_or(caps_recipient);
    if stripped.len() != 64 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(anyhow!(
            "caps_recipient must be a 0x-prefixed 32-byte Sui address; got `{caps_recipient}`"
        ));
    }
    let normalized_recipient = format!("0x{}", stripped.to_lowercase());

    let names = pick_names(symbol);
    let dir = tempfile::Builder::new()
        .prefix("tai-launch-")
        .tempdir()
        .context("creating temp dir for launch")?;

    let toml_path = dir.path().join("Move.toml");
    std::fs::write(&toml_path, MOVE_TOML_TMPL).context("writing Move.toml")?;

    let sources_dir = dir.path().join("sources");
    std::fs::create_dir_all(&sources_dir).context("creating sources/")?;

    // `@{{CAPS_RECIPIENT}}` becomes `@0xabc…123` in the rendered Move.
    // The `@` prefix is the Move address-literal sigil, baked into the
    // template so we substitute only the hex portion here.
    let rendered = COIN_MOVE_TMPL
        .replace("{{MODULE_NAME}}", &names.module)
        .replace("{{WITNESS_NAME}}", &names.witness)
        .replace("{{DECIMALS}}", &decimals.to_string())
        .replace("{{SYMBOL}}", symbol)
        .replace("{{NAME_BYTES}}", name)
        .replace("{{DESCRIPTION_BYTES}}", description)
        .replace("{{ICON_URL_BYTES}}", icon_url)
        .replace("{{CAPS_RECIPIENT}}", &normalized_recipient);

    let coin_path = sources_dir.join("coin.move");
    std::fs::write(&coin_path, rendered).context("writing sources/coin.move")?;

    Ok((dir, names))
}

fn ascii_printable(s: &str) -> bool {
    s.chars().all(|c| (0x20..=0x7E).contains(&(c as u32)))
}

/// Output of a successful `sui client publish --json`. Only the fields
/// we actually consume are present.
#[derive(Debug)]
pub struct PublishOutcome {
    pub package_id: String,
    pub treasury_cap_id: String,
    pub coin_metadata_id: String,
    /// Fully qualified coin type: `0xPKG::<module>::<WITNESS>`.
    pub coin_type: String,
    pub publish_tx_digest: String,
}

/// Shell out to `sui client publish` against the provided package dir.
/// Streams stderr to the parent. Parses JSON to find the published package
/// + the freshly-created TreasuryCap + CoinMetadata for `<witness>`.
/// Hard ceiling on how long `sui client publish` is allowed to run. Move
/// compilation + on-chain submission usually completes in well under a
/// minute; 5 minutes is comfortable headroom and well short of "user
/// thinks the terminal froze."
const SUI_PUBLISH_TIMEOUT_SECS: u64 = 300;

pub async fn publish_with_sui(
    package_dir: &Path,
    sui_bin: &str,
    gas_budget_mist: u64,
    names: &CoinNames,
) -> Result<PublishOutcome> {
    let mut cmd = Command::new(sui_bin);
    cmd.arg("client")
        .arg("publish")
        .arg("--gas-budget")
        .arg(gas_budget_mist.to_string())
        .arg("--json")
        .arg(package_dir);
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(SUI_PUBLISH_TIMEOUT_SECS),
        cmd.output(),
    )
    .await
    .map_err(|_| {
        anyhow!(
            "`{sui_bin} client publish` exceeded {SUI_PUBLISH_TIMEOUT_SECS}s timeout — \
             check your network and gas, then retry"
        )
    })?
    .with_context(|| format!("running `{sui_bin} client publish`"))?;
    if !output.status.success() {
        return Err(anyhow!(
            "`sui client publish` failed (exit {}): {}\nstdout:\n{}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout),
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_start = stdout
        .find('{')
        .ok_or_else(|| anyhow!("no JSON in `sui client publish` output"))?;
    let json: Value =
        serde_json::from_str(&stdout[json_start..]).context("parsing sui publish JSON")?;
    parse_publish_result(&json, names)
}

fn parse_publish_result(json: &Value, names: &CoinNames) -> Result<PublishOutcome> {
    let digest = json
        .get("digest")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("publish output missing `digest`"))?
        .to_string();

    let changes = json
        .get("objectChanges")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("publish output missing `objectChanges`"))?;

    let mut package_id: Option<String> = None;
    let mut treasury_cap_id: Option<String> = None;
    let mut coin_metadata_id: Option<String> = None;
    let witness_suffix = format!("::{}::{}", names.module, names.witness);

    for ch in changes {
        let kind = ch.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "published" {
            if let Some(id) = ch.get("packageId").and_then(|v| v.as_str()) {
                package_id = Some(id.to_string());
            }
        } else if kind == "created" {
            let object_id = ch
                .get("objectId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let object_type = ch.get("objectType").and_then(|v| v.as_str()).unwrap_or("");
            // TreasuryCap<0xPKG::module::WITNESS>
            if object_type.starts_with("0x2::coin::TreasuryCap<")
                && object_type.contains(&witness_suffix)
            {
                treasury_cap_id = Some(object_id);
            // CoinMetadata<0xPKG::module::WITNESS>
            } else if object_type.starts_with("0x2::coin::CoinMetadata<")
                && object_type.contains(&witness_suffix)
            {
                coin_metadata_id = Some(object_id);
            }
        }
    }

    let package_id =
        package_id.ok_or_else(|| anyhow!("publish output has no `published` change"))?;
    let treasury_cap_id = treasury_cap_id.ok_or_else(|| {
        anyhow!("publish output missing freshly-created TreasuryCap<{witness_suffix}>")
    })?;
    let coin_metadata_id = coin_metadata_id.ok_or_else(|| {
        anyhow!("publish output missing freshly-created CoinMetadata<{witness_suffix}>")
    })?;
    let coin_type = format!("{package_id}::{}::{}", names.module, names.witness);

    Ok(PublishOutcome {
        package_id,
        treasury_cap_id,
        coin_metadata_id,
        coin_type,
        publish_tx_digest: digest,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct LaunchSummary {
    pub agent_name: String,
    pub coin_type: String,
    pub coin_module: String,
    pub coin_witness: String,
    pub coin_package_id: String,
    pub coin_metadata_id: String,
    /// TreasuryCap was consumed by `launch_agent_coin`; this field records
    /// the id from the publish step so the user can audit the consumption.
    pub treasury_cap_id_at_publish: String,
    pub publish_tx_digest: String,
    pub launch_tx_digest: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pick_names_produces_lowercase_module_and_uppercase_witness() {
        let names = pick_names("LARRY");
        assert!(names.module.starts_with("larry_"));
        assert_eq!(names.witness, names.module.to_uppercase());
        assert_eq!(names.witness.split('_').last().unwrap().len(), 8);
    }

    #[test]
    fn pick_names_falls_back_to_agent_for_non_alpha_symbols() {
        let names = pick_names("$$$");
        assert!(names.module.starts_with("agent_"));
    }

    #[test]
    fn ascii_printable_accepts_normal_and_rejects_quote_or_unicode() {
        assert!(ascii_printable("hello world!"));
        assert!(ascii_printable("LARRY"));
        assert!(!ascii_printable("héllo")); // accented char
        assert!(!ascii_printable("\nbreak")); // control char
    }

    #[test]
    fn parse_publish_result_extracts_ids() {
        let names = CoinNames {
            module: "demo_abc".into(),
            witness: "DEMO_ABC".into(),
        };
        let v = json!({
            "digest": "ABCDEF",
            "objectChanges": [
                {
                    "type": "published",
                    "packageId": "0xpkg"
                },
                {
                    "type": "created",
                    "objectId": "0xcap",
                    "objectType": "0x2::coin::TreasuryCap<0xpkg::demo_abc::DEMO_ABC>"
                },
                {
                    "type": "created",
                    "objectId": "0xmeta",
                    "objectType": "0x2::coin::CoinMetadata<0xpkg::demo_abc::DEMO_ABC>"
                }
            ]
        });
        let out = parse_publish_result(&v, &names).unwrap();
        assert_eq!(out.package_id, "0xpkg");
        assert_eq!(out.treasury_cap_id, "0xcap");
        assert_eq!(out.coin_metadata_id, "0xmeta");
        assert_eq!(out.coin_type, "0xpkg::demo_abc::DEMO_ABC");
        assert_eq!(out.publish_tx_digest, "ABCDEF");
    }
}
