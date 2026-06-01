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
    let raw =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
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
            signer: SignerConfig {
                mode: "ed25519".into(),
                key_path: "/tmp/k".into(),
            },
        };
        assert!(tai_config_for(&cfg).is_err());
    }
}
