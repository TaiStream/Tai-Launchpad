//! Read-only tools. No signer required.
use crate::protocol::Tool;
use crate::tools::Ctx;
use serde_json::{json, Value};
use tai_core::{hire_quote, LaunchpadAccountView, ObjectId, WorkOrderView};

/// Validate the `agent` arg: a 0x object id or a bare slug (letters/digits/-_).
pub fn parse_agent_id(args: &Value) -> Result<String, String> {
    let s = args
        .get("agent")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing required arg `agent` (object id or slug)".to_string())?
        .trim()
        .to_string();
    let ok = s.starts_with("0x")
        || s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if s.is_empty() || !ok {
        return Err(format!("invalid `agent`: {s:?}"));
    }
    Ok(s)
}

/// Resolve a slug/id to an ObjectId. Known slugs map to their account id.
fn resolve_object_id(s: &str) -> Result<ObjectId, String> {
    let id = if s.starts_with("0x") {
        s.to_string()
    } else if s == "larry" {
        "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e".to_string()
    } else {
        return Err(format!("unknown agent slug: {s}"));
    };
    id.parse::<ObjectId>().map_err(|e| format!("bad object id: {e}"))
}

struct Status {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for Status {
    fn name(&self) -> &str { "tai_status" }
    fn description(&self) -> &str {
        "Show Tai network, the configured signer address (if any), and the canonical package/config ids."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    async fn call(&self, _args: Value) -> Result<String, String> {
        let cfg = tai_core::TaiConfig::testnet_v1();
        Ok(json!({
            "network": "testnet",
            "rpc_url": self.ctx.rpc_url,
            "signer_address": self.ctx.address,
            "package_id": cfg.package_id.to_string(),
            "config_id": cfg.config_id.to_string(),
        })
        .to_string())
    }
}

struct AgentShow {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for AgentShow {
    fn name(&self) -> &str { "tai_agent_show" }
    fn description(&self) -> &str {
        "Read a Tai agent's LaunchpadAccount by object id or known slug: NAV, hire price, cred, balances."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "agent": { "type": "string", "description": "object id or slug" } },
            "required": ["agent"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = resolve_object_id(&parse_agent_id(&args)?)?;
        let account = LaunchpadAccountView::fetch(&self.ctx.rpc, id)
            .await
            .map_err(|e| e.to_string())?;
        let quote = hire_quote(&account);
        Ok(json!({
            "object_id": account.object_id.to_string(),
            "coin_type": account.coin_type,
            "coin_type_name": account.coin_type_name,
            "nav_sui_mist": account.nav_sui.to_string(),
            "hire_price_mist": quote.hire_price_sui.to_string(),
            "cred_multiplier_bps": quote.multiplier_bps.to_string(),
            "real_sui_mist": account.real_sui.to_string(),
            "real_token": account.real_token.to_string(),
        })
        .to_string())
    }
}

struct Quote {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for Quote {
    fn name(&self) -> &str { "tai_quote" }
    fn description(&self) -> &str { "Cred-adjusted hire price (in SUI MIST) for an agent." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "agent": { "type": "string" } }, "required": ["agent"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = resolve_object_id(&parse_agent_id(&args)?)?;
        let account = LaunchpadAccountView::fetch(&self.ctx.rpc, id)
            .await
            .map_err(|e| e.to_string())?;
        let q = hire_quote(&account);
        Ok(json!({
            "hire_price_mist": q.hire_price_sui.to_string(),
            "cred_multiplier_bps": q.multiplier_bps.to_string()
        })
        .to_string())
    }
}

struct WorkOrderShow {
    ctx: Ctx,
}
#[async_trait::async_trait]
impl Tool for WorkOrderShow {
    fn name(&self) -> &str { "tai_work_order_show" }
    fn description(&self) -> &str { "Read a WorkOrder<T> by object id." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object",
            "properties": { "id": { "type": "string" } }, "required": ["id"] })
    }
    async fn call(&self, args: Value) -> Result<String, String> {
        let id = args.get("id").and_then(|v| v.as_str())
            .ok_or_else(|| "missing `id`".to_string())?
            .parse::<ObjectId>().map_err(|e| format!("bad id: {e}"))?;
        let wo = WorkOrderView::fetch(&self.ctx.rpc, id).await.map_err(|e| e.to_string())?;
        Ok(json!({
            "object_id": wo.object_id.to_string(),
            "status": wo.status.label(),
            "buyer": wo.buyer,
            "amount_mist": wo.amount.to_string(),
            "payee_launchpad_account_id": wo.payee_launchpad_account_id.to_string(),
            "deadline_ms": wo.deadline_ms.to_string(),
        })
        .to_string())
    }
}

pub fn register(ctx: &Ctx, out: &mut Vec<Box<dyn Tool>>) {
    out.push(Box::new(Status { ctx: ctx.clone() }));
    out.push(Box::new(AgentShow { ctx: ctx.clone() }));
    out.push(Box::new(Quote { ctx: ctx.clone() }));
    out.push(Box::new(WorkOrderShow { ctx: ctx.clone() }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn agent_id_arg_is_required_and_validated() {
        // missing id
        assert!(parse_agent_id(&json!({})).is_err());
        // non-hex, non-slug-ish junk with spaces
        assert!(parse_agent_id(&json!({ "agent": "not a real id" })).is_err());
        // a known slug passes through
        assert_eq!(parse_agent_id(&json!({ "agent": "larry" })).unwrap(), "larry");
        // a 0x id passes through
        let id = "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e";
        assert_eq!(parse_agent_id(&json!({ "agent": id })).unwrap(), id);
    }
}
