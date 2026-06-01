//! tai-mcp — an MCP stdio server exposing Tai (Sui launchpad) tools to any
//! MCP-capable agent runtime. stdout is the JSON-RPC channel; logs go to stderr.

mod config;
mod protocol;
mod tools;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    eprintln!("tai-mcp starting");
    Ok(())
}
