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
        Ok(Some(cli)) => {
            match (config::tai_config_for(&cli), config::load_signer(&cli).await) {
                (Ok(tai_cfg), Ok(signer)) => {
                    let addr = signer.address().to_string();
                    (Some(Arc::new(TaiClient::new(tai_cfg, signer))), Some(addr))
                }
                (Err(e), _) => {
                    eprintln!("tai-mcp: signer unavailable ({e}); read-only tools only");
                    (None, None)
                }
                (_, Err(e)) => {
                    eprintln!("tai-mcp: signer unavailable ({e}); read-only tools only");
                    (None, None)
                }
            }
        }
        Ok(None) => {
            eprintln!(
                "tai-mcp: no ~/.tai/config.toml; read-only tools only (run `tai init`)"
            );
            (None, None)
        }
        Err(e) => {
            eprintln!("tai-mcp: config error ({e}); read-only tools only");
            (None, None)
        }
    };

    let ctx = tools::Ctx { rpc, rpc_url, client, address };
    let server = protocol::Server::new(tools::all(ctx));
    eprintln!("tai-mcp ready ({} tools)", server.tool_count());
    server.run_stdio().await
}
