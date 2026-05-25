//! Crate-wide error type.

use thiserror::Error;

/// The single error type returned by every fallible `tai-core` function.
#[derive(Debug, Error)]
pub enum TaiError {
    /// A configuration file could not be loaded or was malformed.
    #[error("config error: {0}")]
    Config(String),

    /// A signer operation failed.
    #[error("signer error: {0}")]
    Signer(String),

    /// A Sui RPC call failed.
    #[error("rpc error: {0}")]
    Rpc(String),

    /// The RPC server returned an unexpected shape.
    #[error("rpc response shape: {0}")]
    RpcShape(String),

    /// An address or object ID could not be parsed.
    #[error("invalid address/id: {0}")]
    InvalidAddress(String),

    /// A Move object could not be decoded from its on-chain representation.
    #[error("decode error: {0}")]
    Decode(String),

    /// A transaction was constructed but failed to execute.
    #[error("transaction failed: {0}")]
    TxFailed(String),

    /// I/O failure (filesystem etc).
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization failed.
    #[error("serde_json: {0}")]
    SerdeJson(#[from] serde_json::Error),

    /// HTTP transport failed.
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),

    /// BCS serialization failed.
    #[error("bcs: {0}")]
    Bcs(#[from] bcs::Error),

    /// Hex decode failed.
    #[error("hex: {0}")]
    Hex(#[from] hex::FromHexError),

    /// Catch-all wrapping `anyhow::Error` for things that don't merit a
    /// dedicated variant.
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}
