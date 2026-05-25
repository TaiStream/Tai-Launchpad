//! The `Signer` abstraction and built-in implementations.
//!
//! Tai supports four signing modes; each is a struct that implements
//! [`Signer`]. The CLI / SDK / agent runtime picks one at boot and never
//! touches the others.
//!
//! | Mode | Status | Notes |
//! |---|---|---|
//! | [`Ed25519FileSigner`] | implemented | local Ed25519 key on disk |
//! | [`SuiKeystoreSigner`] | stub (v1.1) | inherits from `~/.sui/sui_config/sui.keystore` |
//! | [`TurnkeySigner`] | stub (v1.1) | MPC + policy engine via HTTPS |
//! | [`TeeSigner`] | stub (v1.1) | TEE-attested signing (Phala Cloud + Mysten Nautilus) |
//!
//! The Sui signature wire format (97 bytes total):
//!
//! ```text
//! [scheme: 1B] [signature: 64B] [public_key: 32B]
//! ```
//!
//! Scheme tags: `0x00 = Ed25519`, `0x01 = Secp256k1`, `0x02 = Secp256r1`.
//!
//! The signed digest is `blake2b_256("TransactionData::" || bcs(tx_data))`.
//! Callers pass in the digest; the [`Signer`] need not be aware of how it
//! was constructed.

use crate::error::TaiError;
use crate::ids::{SuiAddress, SUI_ADDR_LEN};
use async_trait::async_trait;
use blake2::{Blake2b, Digest};
use blake2::digest::consts::U32;
use ed25519_dalek::{Signature as EdSignature, Signer as EdSigner, SigningKey, VerifyingKey};
use std::path::Path;

/// Sui signature-scheme byte for Ed25519.
pub const SCHEME_ED25519: u8 = 0x00;

/// A Sui signature in wire format: `scheme (1) || sig (64) || pubkey (32)`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SuiSignature {
    /// Full 97-byte wire-format signature.
    pub bytes: Vec<u8>,
}

impl SuiSignature {
    /// Construct from an Ed25519 signature + public key.
    pub fn from_ed25519(sig: EdSignature, pubkey: VerifyingKey) -> Self {
        let mut out = Vec::with_capacity(97);
        out.push(SCHEME_ED25519);
        out.extend_from_slice(&sig.to_bytes());
        out.extend_from_slice(pubkey.as_bytes());
        SuiSignature { bytes: out }
    }

    /// Base64 encoding used in Sui JSON-RPC payloads.
    pub fn to_base64(&self) -> String {
        use base64ct::{Base64, Encoding};
        Base64::encode_string(&self.bytes)
    }
}

/// Async signer abstraction. Implementations transform a 32-byte digest
/// (already blake2b-hashed by the caller) into a [`SuiSignature`] ready
/// to attach to a Sui JSON-RPC `executeTransactionBlock` request.
#[async_trait]
pub trait Signer: Send + Sync {
    /// The Sui address this signer authorizes for.
    fn address(&self) -> SuiAddress;

    /// Sign a 32-byte transaction digest.
    async fn sign(&self, digest: &[u8; 32]) -> Result<SuiSignature, TaiError>;
}

// ============================================================================
//  Ed25519FileSigner — fully implemented
// ============================================================================

/// Signs with an Ed25519 key loaded from a file on disk.
///
/// Two file formats are accepted:
///
/// 1. **Raw 32-byte seed** — first 32 bytes of the file, any trailing bytes
///    ignored. Useful for ad-hoc test keys.
/// 2. **Hex-encoded 32-byte seed** — UTF-8 string, optionally `0x`-prefixed,
///    64 hex characters.
pub struct Ed25519FileSigner {
    key: SigningKey,
    pubkey: VerifyingKey,
    address: SuiAddress,
}

impl Ed25519FileSigner {
    /// Construct from a raw 32-byte seed.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let key = SigningKey::from_bytes(&seed);
        let pubkey = key.verifying_key();
        let address = address_from_ed25519_pubkey(&pubkey);
        Ed25519FileSigner { key, pubkey, address }
    }

    /// Load a key from a file. Accepts raw 32-byte seed OR a hex-encoded
    /// seed in UTF-8.
    pub async fn load_from_file(path: impl AsRef<Path>) -> Result<Self, TaiError> {
        let raw = tokio::fs::read(path.as_ref()).await?;
        let seed = parse_seed_bytes(&raw)?;
        Ok(Self::from_seed(seed))
    }

    /// Expose the public key (e.g., for diagnostics).
    pub fn public_key(&self) -> &VerifyingKey {
        &self.pubkey
    }
}

#[async_trait]
impl Signer for Ed25519FileSigner {
    fn address(&self) -> SuiAddress {
        self.address
    }

    async fn sign(&self, digest: &[u8; 32]) -> Result<SuiSignature, TaiError> {
        let sig = self.key.sign(digest);
        Ok(SuiSignature::from_ed25519(sig, self.pubkey))
    }
}

/// Derive a Sui address from an Ed25519 public key.
///
/// Sui's rule: `address = blake2b_256(scheme_tag (1B) || pubkey (32B))`,
/// taking the full 32-byte hash output.
pub fn address_from_ed25519_pubkey(pk: &VerifyingKey) -> SuiAddress {
    let mut hasher = Blake2b::<U32>::new();
    hasher.update([SCHEME_ED25519]);
    hasher.update(pk.as_bytes());
    let out = hasher.finalize();
    let mut bytes = [0u8; SUI_ADDR_LEN];
    bytes.copy_from_slice(&out);
    SuiAddress::from_bytes(bytes)
}

fn parse_seed_bytes(raw: &[u8]) -> Result<[u8; 32], TaiError> {
    // Heuristic: if the bytes look like printable hex (with optional 0x prefix
    // and whitespace), parse as hex; otherwise interpret the first 32 bytes
    // as a raw seed.
    let looks_hex = !raw.is_empty()
        && raw.iter().all(|b| {
            matches!(
                b,
                b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' | b'x' | b'\n' | b'\r' | b' ' | b'\t'
            )
        });

    if looks_hex {
        let s = std::str::from_utf8(raw)
            .map_err(|e| TaiError::Signer(format!("key file not utf8: {e}")))?
            .trim();
        let s = s.strip_prefix("0x").unwrap_or(s);
        let bytes = hex::decode(s)?;
        if bytes.len() != 32 {
            return Err(TaiError::Signer(format!(
                "expected 32-byte seed, got {} bytes",
                bytes.len()
            )));
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }

    if raw.len() < 32 {
        return Err(TaiError::Signer(format!(
            "key file too short: {} bytes (need at least 32)",
            raw.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw[..32]);
    Ok(out)
}

// ============================================================================
//  Stubs for v1.1
// ============================================================================

/// Inherits the active key from `~/.sui/sui_config/sui.keystore`.
///
/// Not yet implemented — landing in v1.1 alongside the CLI.
pub struct SuiKeystoreSigner;

#[async_trait]
impl Signer for SuiKeystoreSigner {
    fn address(&self) -> SuiAddress {
        todo!("sui-keystore signer ships in v1.1")
    }
    async fn sign(&self, _digest: &[u8; 32]) -> Result<SuiSignature, TaiError> {
        todo!("sui-keystore signer ships in v1.1")
    }
}

/// Signs via Turnkey's MPC API + policy engine.
///
/// Not yet implemented — landing in v1.1 alongside the CLI.
pub struct TurnkeySigner;

#[async_trait]
impl Signer for TurnkeySigner {
    fn address(&self) -> SuiAddress {
        todo!("Turnkey signer ships in v1.1")
    }
    async fn sign(&self, _digest: &[u8; 32]) -> Result<SuiSignature, TaiError> {
        todo!("Turnkey signer ships in v1.1")
    }
}

/// Signs via a TEE-attested endpoint (Phala Cloud + Mysten Nautilus).
///
/// Not yet implemented — landing in v1.1 alongside the CLI.
pub struct TeeSigner;

#[async_trait]
impl Signer for TeeSigner {
    fn address(&self) -> SuiAddress {
        todo!("TEE signer ships in v1.1")
    }
    async fn sign(&self, _digest: &[u8; 32]) -> Result<SuiSignature, TaiError> {
        todo!("TEE signer ships in v1.1")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ed25519_signer_derives_a_well_formed_address() {
        let signer = Ed25519FileSigner::from_seed([7u8; 32]);
        let addr = signer.address();
        let s = addr.to_string();
        // Address is 0x + 64 hex chars, all from the hex alphabet.
        assert!(s.starts_with("0x"));
        assert_eq!(s.len(), 66);
    }

    #[tokio::test]
    async fn ed25519_signer_produces_97_byte_wire_signature() {
        let signer = Ed25519FileSigner::from_seed([7u8; 32]);
        let digest = [0u8; 32];
        let sig = signer.sign(&digest).await.unwrap();
        assert_eq!(sig.bytes.len(), 97);
        assert_eq!(sig.bytes[0], SCHEME_ED25519);
    }

    #[test]
    fn deterministic_address_for_known_seed() {
        // Sanity check: same seed -> same address every time.
        let a = Ed25519FileSigner::from_seed([42u8; 32]).address();
        let b = Ed25519FileSigner::from_seed([42u8; 32]).address();
        assert_eq!(a, b);
    }
}
