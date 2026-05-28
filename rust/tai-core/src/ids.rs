//! Typed wrappers for Sui's 32-byte addresses and object IDs.
//!
//! Sui addresses and object IDs are both 32-byte values rendered as
//! hex-prefixed-with-`0x`. We use distinct types so the API can express
//! whether a parameter refers to a wallet address or a specific on-chain
//! object — the bytes are interchangeable but the meaning is not.

use crate::error::TaiError;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Length of a Sui address / object ID in bytes.
pub const SUI_ADDR_LEN: usize = 32;

/// A 32-byte Sui address.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SuiAddress(#[serde(with = "hex_prefixed")] pub [u8; SUI_ADDR_LEN]);

/// A 32-byte Sui object ID.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ObjectId(#[serde(with = "hex_prefixed")] pub [u8; SUI_ADDR_LEN]);

impl fmt::Debug for SuiAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

impl fmt::Display for SuiAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

impl fmt::Debug for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

impl fmt::Display for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

impl FromStr for SuiAddress {
    type Err = TaiError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(SuiAddress(parse_32_hex(s)?))
    }
}

impl FromStr for ObjectId {
    type Err = TaiError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(ObjectId(parse_32_hex(s)?))
    }
}

impl SuiAddress {
    /// The zero address (`0x000…000`). Commonly used as the sender for
    /// `dev_inspect_transaction_block` calls that only need read access.
    pub const ZERO: SuiAddress = SuiAddress([0u8; SUI_ADDR_LEN]);

    /// Construct from a 32-byte array.
    pub fn from_bytes(b: [u8; SUI_ADDR_LEN]) -> Self {
        SuiAddress(b)
    }

    /// Borrow the underlying bytes.
    pub fn as_bytes(&self) -> &[u8; SUI_ADDR_LEN] {
        &self.0
    }
}

impl ObjectId {
    /// Construct from a 32-byte array.
    pub fn from_bytes(b: [u8; SUI_ADDR_LEN]) -> Self {
        ObjectId(b)
    }

    /// Borrow the underlying bytes.
    pub fn as_bytes(&self) -> &[u8; SUI_ADDR_LEN] {
        &self.0
    }
}

fn parse_32_hex(s: &str) -> Result<[u8; SUI_ADDR_LEN], TaiError> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    // Sui allows leading-zero compression in CLI output (e.g. "0x6"); for
    // robustness, left-pad to 64 hex chars.
    let padded: String = if s.len() < 64 {
        format!("{:0>64}", s)
    } else {
        s.to_string()
    };
    if padded.len() != 64 {
        return Err(TaiError::InvalidAddress(format!(
            "expected 32 bytes (64 hex chars), got {}",
            s.len()
        )));
    }
    let bytes =
        hex::decode(&padded).map_err(|e| TaiError::InvalidAddress(format!("hex decode: {e}")))?;
    let mut out = [0u8; SUI_ADDR_LEN];
    out.copy_from_slice(&bytes);
    Ok(out)
}

/// Serde helper for `[u8; 32]` <-> hex-prefixed string.
mod hex_prefixed {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(b: &[u8; 32], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&format!("0x{}", hex::encode(b)))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 32], D::Error> {
        let s = String::deserialize(d)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let padded: String = if s.len() < 64 {
            format!("{:0>64}", s)
        } else {
            s.to_string()
        };
        let bytes = hex::decode(&padded).map_err(serde::de::Error::custom)?;
        if bytes.len() != 32 {
            return Err(serde::de::Error::custom("expected 32 bytes"));
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_full_64_hex() {
        let s = "0x7d41072ae77b18b752292b47468e07e6332cd9a6ef9b052752f98f22d9844f8d";
        let id: ObjectId = s.parse().unwrap();
        assert_eq!(id.to_string(), s);
    }

    #[test]
    fn parse_short_hex_is_left_padded() {
        let id: ObjectId = "0x6".parse().unwrap();
        assert_eq!(
            id.to_string(),
            "0x0000000000000000000000000000000000000000000000000000000000000006"
        );
    }

    #[test]
    fn parse_without_prefix() {
        let id: SuiAddress = "ad".parse().unwrap();
        assert_eq!(
            id.to_string(),
            "0x00000000000000000000000000000000000000000000000000000000000000ad"
        );
    }

    #[test]
    fn rejects_too_long() {
        let s = "0x".to_string() + &"a".repeat(65);
        assert!(s.parse::<ObjectId>().is_err());
    }

    #[test]
    fn zero_address_constant() {
        assert_eq!(
            SuiAddress::ZERO.to_string(),
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        );
    }

    #[test]
    fn json_roundtrip() {
        let id: ObjectId = "0x7d41072ae77b18b752292b47468e07e6332cd9a6ef9b052752f98f22d9844f8d"
            .parse()
            .unwrap();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(
            json,
            "\"0x7d41072ae77b18b752292b47468e07e6332cd9a6ef9b052752f98f22d9844f8d\""
        );
        let id2: ObjectId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, id2);
    }
}
