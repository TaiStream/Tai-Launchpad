//! Network configuration: which Tai deployment to talk to.

use crate::error::TaiError;
use crate::ids::ObjectId;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Which Sui network to target.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    /// Sui testnet — the network the v1 package is currently published to.
    Testnet,
    /// Sui mainnet.
    Mainnet,
    /// Sui devnet (for local SDK development).
    Devnet,
    /// A custom RPC endpoint (e.g., a local validator).
    Custom,
}

impl Network {
    /// Default public JSON-RPC endpoint for the network.
    pub fn default_rpc_url(self) -> &'static str {
        match self {
            Network::Testnet => "https://fullnode.testnet.sui.io",
            Network::Mainnet => "https://fullnode.mainnet.sui.io",
            Network::Devnet => "https://fullnode.devnet.sui.io",
            Network::Custom => "",
        }
    }
}

impl FromStr for Network {
    type Err = TaiError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "testnet" => Ok(Network::Testnet),
            "mainnet" => Ok(Network::Mainnet),
            "devnet" => Ok(Network::Devnet),
            "custom" => Ok(Network::Custom),
            other => Err(TaiError::Config(format!("unknown network: {other}"))),
        }
    }
}

/// All the on-chain pointers a client needs to interact with a Tai
/// deployment: the package id (immutable), the shared `LaunchpadConfig`
/// id, and the RPC endpoint.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaiConfig {
    /// Which Sui network this config targets.
    pub network: Network,
    /// HTTP JSON-RPC endpoint.
    pub rpc_url: String,
    /// Address of the deployed `tai` Move package.
    pub package_id: ObjectId,
    /// Object id of the shared `LaunchpadConfig` created at publish time.
    pub config_id: ObjectId,
}

impl TaiConfig {
    /// The current canonical testnet deployment of the v1 Tai package.
    /// Points at v1.1.1 — the in-place upgrade of v1.1.0 that added
    /// spec/receipt length bounds (L4). The package_id is the upgraded
    /// package; the config_id is unchanged across the upgrade (Sui
    /// upgrades don't move existing objects).
    ///
    /// Source: `move/published.json` in this repo. Upgraded 2026-05-28 at
    /// checkpoint 342196917, tx HmVRYzXdgnxTy97h71bUH6N2m567afy1Bc9wjuUjokLn.
    /// Type/event anchor remains the v1.1.0 package
    /// 0x7d86697afc21895a94687ee5c16012384862d43dfd8a6841e2e4a0ac0690efb3.
    pub fn testnet_v1() -> Self {
        TaiConfig {
            network: Network::Testnet,
            rpc_url: Network::Testnet.default_rpc_url().to_string(),
            package_id: ObjectId::from_bytes(hex_lit(
                "74e4c3f857cc97d2f68c59fcce30671f15e8fa1e05952c48287e459727af111d",
            )),
            config_id: ObjectId::from_bytes(hex_lit(
                "4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50",
            )),
        }
    }
}

const fn hex_lit(s: &str) -> [u8; 32] {
    let bytes = s.as_bytes();
    assert!(bytes.len() == 64, "hex literal must be 64 chars");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = nibble(bytes[2 * i]) * 16 + nibble(bytes[2 * i + 1]);
        i += 1;
    }
    out
}

const fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => 10 + (c - b'a'),
        b'A'..=b'F' => 10 + (c - b'A'),
        _ => panic!("invalid hex char"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn testnet_v1_has_known_ids() {
        let cfg = TaiConfig::testnet_v1();
        assert_eq!(cfg.network, Network::Testnet);
        assert_eq!(
            cfg.package_id.to_string(),
            "0x74e4c3f857cc97d2f68c59fcce30671f15e8fa1e05952c48287e459727af111d"
        );
        assert_eq!(
            cfg.config_id.to_string(),
            "0x4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50"
        );
        assert_eq!(cfg.rpc_url, "https://fullnode.testnet.sui.io");
    }

    #[test]
    fn network_parses_case_insensitive() {
        assert_eq!("Testnet".parse::<Network>().unwrap(), Network::Testnet);
        assert_eq!("MAINNET".parse::<Network>().unwrap(), Network::Mainnet);
        assert!("polygon".parse::<Network>().is_err());
    }
}
