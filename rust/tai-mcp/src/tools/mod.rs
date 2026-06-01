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
