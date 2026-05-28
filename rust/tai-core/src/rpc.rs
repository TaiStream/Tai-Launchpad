//! Minimal Sui JSON-RPC 2.0 client.
//!
//! `tai-core` doesn't pull in the full `sui-sdk` crate; for the read surface
//! we need (object reads + dev-inspect) a thin HTTP+JSON wrapper is enough.
//! Pure-Rust BCS transaction construction lives in `ptb.rs` (Phase 11.5).

use crate::error::TaiError;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A Sui JSON-RPC 2.0 client over reqwest.
#[derive(Clone, Debug)]
pub struct RpcClient {
    http: Client,
    endpoint: String,
}

#[derive(Serialize)]
struct Request<'a, P> {
    jsonrpc: &'a str,
    id: u64,
    method: &'a str,
    params: P,
}

#[derive(Deserialize)]
struct Response<R> {
    #[serde(default, rename = "jsonrpc")]
    _jsonrpc: Option<String>,
    #[serde(default, rename = "id")]
    _id: Option<u64>,
    result: Option<R>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(default)]
    _data: Option<Value>,
}

/// Default per-request timeout for the Sui RPC client. Slow public testnet
/// fullnodes occasionally take a few seconds for `multiGetObjects`, but
/// nothing should ever take 30+. Lets the CLI fail loud instead of hanging.
const DEFAULT_RPC_TIMEOUT_SECS: u64 = 30;

impl RpcClient {
    /// Construct a client pointing at the given JSON-RPC endpoint URL.
    /// Applies a 30-second per-request timeout. Use [`RpcClient::with_timeout`]
    /// if you need a different cap.
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self::with_timeout(
            endpoint,
            std::time::Duration::from_secs(DEFAULT_RPC_TIMEOUT_SECS),
        )
    }

    /// Construct with an explicit per-request timeout.
    pub fn with_timeout(endpoint: impl Into<String>, timeout: std::time::Duration) -> Self {
        RpcClient {
            http: Client::builder()
                .user_agent(concat!("tai-core/", env!("CARGO_PKG_VERSION")))
                .timeout(timeout)
                .build()
                .expect("reqwest client construction"),
            endpoint: endpoint.into(),
        }
    }

    /// Issue a JSON-RPC 2.0 call and deserialize the `result` field into `R`.
    pub async fn call<P, R>(&self, method: &str, params: P) -> Result<R, TaiError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let req = Request {
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        };
        let resp = self
            .http
            .post(&self.endpoint)
            .json(&req)
            .send()
            .await?
            .error_for_status()?
            .json::<Response<R>>()
            .await?;
        if let Some(err) = resp.error {
            return Err(TaiError::Rpc(format!("code {}: {}", err.code, err.message)));
        }
        resp.result
            .ok_or_else(|| TaiError::RpcShape("missing `result` field".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn constructs_without_panicking() {
        // Sanity: client is constructable. Network behavior covered by the
        // testnet integration test in reads_tests.
        let _c = RpcClient::new("https://fullnode.testnet.sui.io");
    }
}
