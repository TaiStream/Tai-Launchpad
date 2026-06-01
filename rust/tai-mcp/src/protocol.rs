//! MCP-over-stdio engine. MCP messages are JSON-RPC 2.0 objects, one per line
//! on stdout. stdout is RESERVED for protocol bytes; everything else → stderr.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOL_VERSION: &str = "2024-11-05";

/// A callable tool. `call` returns Ok(text) on success or Err(text) on a
/// tool-level failure (surfaced to the model as an isError result, not a
/// protocol error).
#[async_trait::async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    async fn call(&self, args: Value) -> Result<String, String>;
}

pub struct Server {
    tools: Vec<Box<dyn Tool>>,
}

impl Server {
    pub fn new(tools: Vec<Box<dyn Tool>>) -> Self {
        Self { tools }
    }

    /// Number of registered tools (used in the startup log).
    pub fn tool_count(&self) -> usize {
        self.tools.len()
    }

    /// Handle one parsed JSON-RPC message. Returns Some(response) for requests
    /// (those with an `id`) and None for notifications.
    pub async fn handle(&self, msg: Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        // Notifications (no id) get no response.
        let id = id?;

        match method {
            "initialize" => {
                let pv = msg
                    .get("params")
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(PROTOCOL_VERSION)
                    .to_string();
                Some(ok(
                    id,
                    json!({
                        "protocolVersion": pv,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": "tai-mcp", "version": env!("CARGO_PKG_VERSION") }
                    }),
                ))
            }
            "ping" => Some(ok(id, json!({}))),
            "tools/list" => {
                let tools: Vec<Value> = self
                    .tools
                    .iter()
                    .map(|t| {
                        json!({
                            "name": t.name(),
                            "description": t.description(),
                            "inputSchema": t.input_schema()
                        })
                    })
                    .collect();
                Some(ok(id, json!({ "tools": tools })))
            }
            "tools/call" => {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match self.tools.iter().find(|t| t.name() == name) {
                    None => Some(ok(id, tool_result(format!("unknown tool: {name}"), true))),
                    Some(tool) => match tool.call(args).await {
                        Ok(text) => Some(ok(id, tool_result(text, false))),
                        Err(text) => Some(ok(id, tool_result(text, true))),
                    },
                }
            }
            other => Some(err(id, -32601, format!("method not found: {other}"))),
        }
    }

    /// Read newline-delimited JSON-RPC from stdin, write responses to stdout.
    pub async fn run_stdio(&self) -> anyhow::Result<()> {
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        let mut out = tokio::io::stdout();
        while let Some(line) = lines.next_line().await? {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(e) => {
                    // Parse error with null id, per JSON-RPC.
                    let resp = err(Value::Null, -32700, format!("parse error: {e}"));
                    write_line(&mut out, &resp).await?;
                    continue;
                }
            };
            if let Some(resp) = self.handle(parsed).await {
                write_line(&mut out, &resp).await?;
            }
        }
        Ok(())
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: Value, code: i64, message: String) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_result(text: String, is_error: bool) -> Value {
    json!({ "content": [ { "type": "text", "text": text } ], "isError": is_error })
}

async fn write_line<W: AsyncWriteExt + Unpin>(out: &mut W, v: &Value) -> anyhow::Result<()> {
    let mut s = serde_json::to_string(v)?;
    s.push('\n');
    out.write_all(s.as_bytes()).await?;
    out.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct EchoTool;
    #[async_trait::async_trait]
    impl Tool for EchoTool {
        fn name(&self) -> &str { "echo" }
        fn description(&self) -> &str { "echoes the `msg` arg" }
        fn input_schema(&self) -> serde_json::Value {
            json!({"type":"object","properties":{"msg":{"type":"string"}},"required":["msg"]})
        }
        async fn call(&self, args: serde_json::Value) -> Result<String, String> {
            Ok(args.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string())
        }
    }

    fn server() -> Server { Server::new(vec![Box::new(EchoTool)]) }

    #[tokio::test]
    async fn initialize_echoes_protocol_version_and_advertises_tools() {
        let req = json!({"jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
        assert!(resp["result"]["capabilities"]["tools"].is_object());
        assert_eq!(resp["result"]["serverInfo"]["name"], "tai-mcp");
    }

    #[tokio::test]
    async fn tools_list_returns_registered_tools() {
        let req = json!({"jsonrpc":"2.0","id":2,"method":"tools/list"});
        let resp = server().handle(req).await.expect("response");
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "echo");
        assert!(tools[0]["inputSchema"].is_object());
    }

    #[tokio::test]
    async fn tools_call_runs_the_tool_and_wraps_text_content() {
        let req = json!({"jsonrpc":"2.0","id":3,"method":"tools/call",
            "params":{"name":"echo","arguments":{"msg":"hi"}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["content"][0]["type"], "text");
        assert_eq!(resp["result"]["content"][0]["text"], "hi");
        assert!(resp["result"]["isError"].is_null() || resp["result"]["isError"] == false);
    }

    #[tokio::test]
    async fn unknown_tool_returns_iserror_result() {
        let req = json!({"jsonrpc":"2.0","id":4,"method":"tools/call",
            "params":{"name":"nope","arguments":{}}});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["result"]["isError"], true);
    }

    #[tokio::test]
    async fn notification_without_id_yields_no_response() {
        let req = json!({"jsonrpc":"2.0","method":"notifications/initialized"});
        assert!(server().handle(req).await.is_none());
    }

    #[tokio::test]
    async fn unknown_method_returns_jsonrpc_error() {
        let req = json!({"jsonrpc":"2.0","id":5,"method":"frobnicate"});
        let resp = server().handle(req).await.expect("response");
        assert_eq!(resp["error"]["code"], -32601);
    }
}
