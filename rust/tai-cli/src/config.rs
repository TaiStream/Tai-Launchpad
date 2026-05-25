//! `~/.tai/config.toml` — persisted CLI config.
//!
//! v1 is intentionally minimal: which network + which signer. The package /
//! LaunchpadConfig IDs come from `tai_core::TaiConfig::testnet_v1()`, so the
//! user only needs to pick a key.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tai_core::Network;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CliConfig {
    /// Which Sui network to target. `testnet` for v1.
    pub network: String,
    pub signer: SignerConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignerConfig {
    /// Signer kind. Today only `ed25519` is implemented. `sui-keystore`,
    /// `turnkey`, `tee` are reserved for v1.1.
    pub mode: String,
    /// Absolute path to the 32-byte seed (raw or hex-encoded).
    pub key_path: PathBuf,
}

impl CliConfig {
    pub fn network(&self) -> Result<Network> {
        self.network
            .parse::<Network>()
            .map_err(|e| anyhow!("invalid network in config: {e}"))
    }
}

/// `~/.tai/config.toml` — resolves `~` via the `dirs` crate.
pub fn default_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve $HOME"))?;
    Ok(home.join(".tai").join("config.toml"))
}

/// Default keys directory: `~/.tai/keys/`.
pub fn default_keys_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("could not resolve $HOME"))?;
    Ok(home.join(".tai").join("keys"))
}

pub fn load(path: &Path) -> Result<CliConfig> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))?;
    let cfg: CliConfig = toml::from_str(&raw).context("parsing config.toml")?;
    Ok(cfg)
}

pub fn save(path: &Path, cfg: &CliConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    let toml_str = toml::to_string_pretty(cfg).context("serializing config")?;
    std::fs::write(path, toml_str)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}
