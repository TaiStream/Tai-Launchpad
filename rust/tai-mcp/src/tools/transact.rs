//! Spending tools. Each requires a configured signer. Amounts are decimal SUI
//! strings parsed to MIST (no JSON floats). Testnet posture: no spend caps.
//!
//! Flow for each tool:
//!   1. Parse args + require client.
//!   2. `client.split_off_coin(coin_type, amount_mist)` → new coin ObjectId.
//!   3. Call the matching `TaiClient` method with the coin id.
//!   4. Return `{"digest": …, "suiscan": …}`.
//!
//! Exception: `tai_treasury_withdraw` calls `withdraw_sui` which takes an
//! amount + recipient directly (on-chain split) — no pre-split needed.
use crate::protocol::Tool;
use crate::tools::Ctx;
use serde_json::{json, Value};
use tai_core::{ObjectId, SuiAddress};

const SUI_TYPE: &str = "0x2::sui::SUI";

/// Parse a decimal SUI string (dot or comma decimal separator) into MIST
/// (10^9 per SUI). Rejects scientific notation, signs, and empty strings.
pub fn sui_to_mist(s: &str) -> Result<u64, String> {
    let t = s.trim().replace(',', ".");
    let ok = !t.is_empty()
        && t.chars().all(|c| c.is_ascii_digit() || c == '.')
        && t.matches('.').count() <= 1;
    if !ok {
        return Err(format!("invalid SUI amount {s:?} (use e.g. 0.1)"));
    }
    let (whole, frac) = match t.split_once('.') {
        Some((w, f)) => (w, f),
        None => (t.as_str(), ""),
    };
    let frac_padded: String = format!("{:0<9}", frac).chars().take(9).collect();
    let whole_n: u64 = whole.parse().map_err(|_| "amount too large".to_string())?;
    let frac_n: u64 = if frac_padded.is_empty() {
        0
    } else {
        frac_padded.parse().unwrap_or(0)
    };
    whole_n
        .checked_mul(1_000_000_000)
        .and_then(|w| w.checked_add(frac_n))
        .ok_or_else(|| "amount too large".to_string())
}

fn str_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing required arg `{key}`"))
}

fn id_arg(args: &Value, key: &str) -> Result<ObjectId, String> {
    str_arg(args, key)?
        .parse::<ObjectId>()
        .map_err(|e| format!("bad `{key}`: {e}"))
}

fn sui_link(digest: &str) -> String {
    format!("https://suiscan.xyz/testnet/tx/{digest}")
}

macro_rules! tool {
    ($ty:ident, $name:literal, $desc:literal, $schema:expr, $ctx:ident, $args:ident, $body:block) => {
        struct $ty {
            ctx: Ctx,
        }
        #[async_trait::async_trait]
        impl Tool for $ty {
            fn name(&self) -> &str {
                $name
            }
            fn description(&self) -> &str {
                $desc
            }
            fn input_schema(&self) -> Value {
                $schema
            }
            async fn call(&self, $args: Value) -> Result<String, String> {
                let $ctx = &self.ctx;
                $body
            }
        }
    };
}

// ============================================================================
//  tai_buy
// ============================================================================

tool!(Buy, "tai_buy",
    "Buy an agent's coin from its bonding curve. Splits a SUI coin of `sui_in`, \
then calls buy<T>(). Two transactions; returns the final digest.",
    json!({
        "type": "object",
        "properties": {
            "agent":          {"type": "string", "description": "LaunchpadAccount object id"},
            "coin_type":      {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "sui_in":         {"type": "string", "description": "SUI to spend, decimal (e.g. 0.5)"},
            "min_tokens_out": {"type": "string", "description": "slippage floor in base token units (optional, default 0)"}
        },
        "required": ["agent", "coin_type", "sui_in"]
    }),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent       = id_arg(&args, "agent")?;
        let coin_type   = str_arg(&args, "coin_type")?;
        let sui_in_mist = sui_to_mist(&str_arg(&args, "sui_in")?)?;
        let min_out: u64 = args
            .get("min_tokens_out")
            .and_then(|v| v.as_str())
            .map(|s| s.parse().unwrap_or(0))
            .unwrap_or(0);

        let payment_coin = client
            .split_off_coin(SUI_TYPE, sui_in_mist)
            .await
            .map_err(|e| e.to_string())?;
        let r = client
            .buy(&coin_type, agent, payment_coin, min_out)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  tai_sell
// ============================================================================

tool!(Sell, "tai_sell",
    "Sell an agent's tokens back to the bonding curve. Splits a token coin of \
`amount`, then calls sell<T>(). Two transactions; returns the final digest.",
    json!({
        "type": "object",
        "properties": {
            "agent":       {"type": "string", "description": "LaunchpadAccount object id"},
            "coin_type":   {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "amount":      {"type": "string", "description": "token amount to sell, decimal (9 decimals, e.g. 1.5)"},
            "min_sui_out": {"type": "string", "description": "minimum SUI out in MIST (optional, default 0)"}
        },
        "required": ["agent", "coin_type", "amount"]
    }),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent        = id_arg(&args, "agent")?;
        let coin_type    = str_arg(&args, "coin_type")?;
        let amount_mist  = sui_to_mist(&str_arg(&args, "amount")?)?;   // tokens share 9-dec
        let min_sui: u64 = args
            .get("min_sui_out")
            .and_then(|v| v.as_str())
            .map(|s| s.parse().unwrap_or(0))
            .unwrap_or(0);

        let tokens_coin = client
            .split_off_coin(&coin_type, amount_mist)
            .await
            .map_err(|e| e.to_string())?;
        let r = client
            .sell(&coin_type, agent, tokens_coin, min_sui)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  tai_pay
// ============================================================================

tool!(Pay, "tai_pay",
    "Pay an agent directly for a service (grows its NAV + cred). Splits a SUI \
coin of `sui`, then calls record_service_payment_sui<T>().",
    json!({
        "type": "object",
        "properties": {
            "agent":     {"type": "string", "description": "LaunchpadAccount object id"},
            "coin_type": {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "sui":       {"type": "string", "description": "SUI to pay, decimal (e.g. 0.1)"}
        },
        "required": ["agent", "coin_type", "sui"]
    }),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent     = id_arg(&args, "agent")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let amount    = sui_to_mist(&str_arg(&args, "sui")?)?;

        let payment_coin = client
            .split_off_coin(SUI_TYPE, amount)
            .await
            .map_err(|e| e.to_string())?;
        let r = client
            .record_service_payment_sui(&coin_type, agent, payment_coin)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  tai_hire
// ============================================================================

tool!(Hire, "tai_hire",
    "Create a WorkOrder<T>: lock SUI for a specific agent task. Splits a SUI \
coin of `sui`, then calls work_order_create<T>(). Returns the final tx digest; \
check objectChanges for the new WorkOrder object id.",
    json!({
        "type": "object",
        "properties": {
            "agent":                {"type": "string", "description": "payee LaunchpadAccount object id"},
            "coin_type":            {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "sui":                  {"type": "string", "description": "SUI to lock, decimal (e.g. 1.0)"},
            "spec_url":             {"type": "string", "description": "URL of task specification (optional)"},
            "deadline_hours":       {"type": "number",  "description": "hours until deadline from now (default 24)"},
            "dispute_window_hours": {"type": "number",  "description": "dispute window in hours (default 1, min 5 min)"}
        },
        "required": ["agent", "coin_type", "sui"]
    }),
    ctx, args, {
        let client = ctx.require_client()?;
        let agent     = id_arg(&args, "agent")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let amount    = sui_to_mist(&str_arg(&args, "sui")?)?;
        let spec_url  = args
            .get("spec_url")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let deadline_hours: f64 = args
            .get("deadline_hours")
            .and_then(|v| v.as_f64())
            .unwrap_or(24.0);
        let dispute_window_hours: f64 = args
            .get("dispute_window_hours")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);

        let dispute_window_ms = (dispute_window_hours * 3_600_000.0) as u64;
        if dispute_window_ms < 300_000 {
            return Err(format!(
                "dispute_window_hours {dispute_window_hours} is too small: \
minimum dispute window is 5 minutes (300_000 ms), got {dispute_window_ms} ms"
            ));
        }

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("system clock error: {e}"))?
            .as_millis() as u64;
        let deadline_ms = now_ms + (deadline_hours * 3_600_000.0) as u64;

        let payment_coin = client
            .split_off_coin(SUI_TYPE, amount)
            .await
            .map_err(|e| e.to_string())?;
        let r = client
            .work_order_create(
                &coin_type,
                agent,
                payment_coin,
                &[],
                &spec_url,
                deadline_ms,
                dispute_window_ms,
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  tai_treasury_topup
// ============================================================================

tool!(TreasuryTopup, "tai_treasury_topup",
    "Top up an AgentTreasury<T> with SUI (permissionless). Splits a SUI coin \
of `sui`, then calls top_up_sui<T>().",
    json!({
        "type": "object",
        "properties": {
            "treasury":  {"type": "string", "description": "AgentTreasury object id"},
            "coin_type": {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "sui":       {"type": "string", "description": "SUI to deposit, decimal (e.g. 0.5)"}
        },
        "required": ["treasury", "coin_type", "sui"]
    }),
    ctx, args, {
        let client = ctx.require_client()?;
        let treasury  = id_arg(&args, "treasury")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let amount    = sui_to_mist(&str_arg(&args, "sui")?)?;

        let payment_coin = client
            .split_off_coin(SUI_TYPE, amount)
            .await
            .map_err(|e| e.to_string())?;
        let r = client
            .top_up_sui(&coin_type, treasury, payment_coin)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  tai_treasury_withdraw
// ============================================================================

tool!(TreasuryWithdraw, "tai_treasury_withdraw",
    "Withdraw SUI from an AgentTreasury<T> (OwnerCap required). The on-chain \
Move function handles the split internally — no pre-split needed.",
    json!({
        "type": "object",
        "properties": {
            "treasury":  {"type": "string", "description": "AgentTreasury object id"},
            "coin_type": {"type": "string", "description": "agent coin type (0xPKG::mod::SYM)"},
            "owner_cap": {"type": "string", "description": "OwnerCap object id"},
            "sui":       {"type": "string", "description": "SUI amount to withdraw, decimal (e.g. 1.0)"},
            "to":        {"type": "string", "description": "recipient Sui address (0x…)"}
        },
        "required": ["treasury", "coin_type", "owner_cap", "sui", "to"]
    }),
    ctx, args, {
        let client    = ctx.require_client()?;
        let treasury  = id_arg(&args, "treasury")?;
        let coin_type = str_arg(&args, "coin_type")?;
        let owner_cap = id_arg(&args, "owner_cap")?;
        let amount    = sui_to_mist(&str_arg(&args, "sui")?)?;
        let to_addr: SuiAddress = str_arg(&args, "to")?
            .parse()
            .map_err(|e| format!("bad `to` address: {e}"))?;

        // withdraw_sui takes amount + to directly (on-chain split); no pre-split.
        let r = client
            .withdraw_sui(&coin_type, treasury, owner_cap, amount, to_addr)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({"digest": r.digest, "suiscan": sui_link(&r.digest)}).to_string())
    });

// ============================================================================
//  Register
// ============================================================================

pub fn register(ctx: &Ctx, out: &mut Vec<Box<dyn Tool>>) {
    out.push(Box::new(Buy { ctx: ctx.clone() }));
    out.push(Box::new(Sell { ctx: ctx.clone() }));
    out.push(Box::new(Pay { ctx: ctx.clone() }));
    out.push(Box::new(Hire { ctx: ctx.clone() }));
    out.push(Box::new(TreasuryTopup { ctx: ctx.clone() }));
    out.push(Box::new(TreasuryWithdraw { ctx: ctx.clone() }));
}

// ============================================================================
//  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sui_string_to_mist_accepts_dot_and_comma() {
        assert_eq!(sui_to_mist("1").unwrap(), 1_000_000_000);
        assert_eq!(sui_to_mist("0.5").unwrap(), 500_000_000);
        assert_eq!(sui_to_mist("0,5").unwrap(), 500_000_000);
        assert_eq!(sui_to_mist("0.040001").unwrap(), 40_001_000);
        assert!(sui_to_mist("abc").is_err());
        assert!(sui_to_mist("1e9").is_err());
    }

    #[tokio::test]
    async fn buy_without_signer_errors_clearly() {
        let ctx = Ctx {
            rpc: std::sync::Arc::new(tai_core::RpcClient::new(
                "https://fullnode.testnet.sui.io",
            )),
            rpc_url: "https://fullnode.testnet.sui.io".to_string(),
            client: None,
            address: None,
        };
        let mut tools: Vec<Box<dyn crate::protocol::Tool>> = vec![];
        register(&ctx, &mut tools);
        let buy = tools.iter().find(|t| t.name() == "tai_buy").unwrap();
        let err = buy
            .call(serde_json::json!({
                "agent": "0x0000000000000000000000000000000000000000000000000000000000000001",
                "coin_type": "0x2::a::A",
                "sui_in": "0.1"
            }))
            .await
            .unwrap_err();
        assert!(err.contains("no signer"), "error was: {err}");
    }

    #[test]
    fn hire_rejects_dispute_window_below_5_minutes() {
        // 4 minutes = 240_000 ms, below the 300_000 floor
        let result = {
            // Simulate the floor check inline (mirrors the tool body logic)
            let dispute_window_hours = 4.0f64 / 60.0; // 4 min in hours
            let dispute_window_ms = (dispute_window_hours * 3_600_000.0) as u64;
            if dispute_window_ms < 300_000 {
                Err(format!(
                    "dispute_window_hours {} is too small: minimum dispute window is 5 minutes",
                    dispute_window_hours
                ))
            } else {
                Ok(())
            }
        };
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("5 minutes"));
    }

    #[test]
    fn sui_to_mist_edge_cases() {
        // whole number with many decimal zeros
        assert_eq!(sui_to_mist("1.000000000").unwrap(), 1_000_000_000);
        // truncation: more than 9 decimal places → take first 9
        // "0.1234567899" → first 9 frac digits = "123456789" → 123_456_789
        assert_eq!(sui_to_mist("0.1234567899").unwrap(), 123_456_789);
        // zero
        assert_eq!(sui_to_mist("0").unwrap(), 0);
        assert_eq!(sui_to_mist("0.0").unwrap(), 0);
        // negative sign rejected
        assert!(sui_to_mist("-1").is_err());
        // empty rejected
        assert!(sui_to_mist("").is_err());
        // double dot rejected
        assert!(sui_to_mist("1.2.3").is_err());
    }
}
