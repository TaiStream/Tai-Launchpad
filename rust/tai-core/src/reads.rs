//! Read-side views over the on-chain Tai objects.
//!
//! Every Move struct field is mirrored as a typed Rust field. Sui returns
//! numerics as decimal strings inside `Move struct JSON`; we parse them to
//! `u64`/`u128` here so callers get strongly-typed values.

use crate::error::TaiError;
use crate::ids::{ObjectId, SuiAddress};
use crate::rpc::RpcClient;
use serde::Deserialize;
use serde_json::{json, Value};

/// All 17 mutable fields of the on-chain `LaunchpadConfig` plus its address.
#[derive(Clone, Debug)]
pub struct LaunchpadConfigView {
    /// On-chain object id.
    pub object_id: ObjectId,
    /// Current admin.
    pub admin: SuiAddress,
    /// Platform treasury — receives the platform share of every trade fee.
    pub platform_treasury: SuiAddress,

    // Trade fee
    /// Trade fee in basis points (default 100 = 1%).
    pub trade_fee_bps: u64,
    /// Trade fee NAV share (default 3000).
    pub trade_nav_share_bps: u64,
    /// Trade fee creator share (default 6000).
    pub trade_creator_share_bps: u64,
    /// Trade fee platform share (default 1000).
    pub trade_platform_share_bps: u64,

    // Service-SUI fee
    /// Service-SUI fee NAV share (default 4000).
    pub service_nav_share_bps: u64,
    /// Service-SUI fee creator share (default 5000).
    pub service_creator_share_bps: u64,
    /// Service-SUI fee platform share (default 1000).
    pub service_platform_share_bps: u64,

    // Service-token fee
    /// Service-token fee NAV-in-T share (default 4000).
    pub token_service_nav_share_bps: u64,
    /// Service-token fee burn share (default 5000).
    pub token_service_burn_share_bps: u64,
    /// Service-token fee creator share (default 1000).
    pub token_service_creator_share_bps: u64,

    // Curve
    /// Virtual SUI reserves (default 10_000 SUI in MIST).
    pub virtual_sui_reserves: u64,
    /// Virtual token reserves (default 1.073B with 9 decimals).
    pub virtual_token_reserves: u64,
    /// Sale supply minted into the curve at launch.
    pub sale_supply: u64,
    /// LP reserve supply minted at launch and locked.
    pub lp_supply: u64,

    /// Lifetime service revenue threshold at which cred multiplier saturates at 2.0x.
    pub cred_revenue_target: u64,
}

impl LaunchpadConfigView {
    /// Fetch the `LaunchpadConfig` at `object_id` from the given RPC.
    pub async fn fetch(rpc: &RpcClient, object_id: ObjectId) -> Result<Self, TaiError> {
        let params = json!([
            object_id.to_string(),
            { "showContent": true }
        ]);
        let raw: Value = rpc.call("sui_getObject", params).await?;
        decode_launchpad_config(&raw, object_id)
    }
}

fn decode_launchpad_config(raw: &Value, expected_id: ObjectId) -> Result<LaunchpadConfigView, TaiError> {
    let data = raw
        .get("data")
        .ok_or_else(|| TaiError::Decode("missing `data` in getObject response".into()))?;
    let content = data
        .get("content")
        .ok_or_else(|| TaiError::Decode("missing `content` in getObject response".into()))?;

    let data_type = content
        .get("dataType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if data_type != "moveObject" {
        return Err(TaiError::Decode(format!(
            "expected moveObject, got {}",
            data_type
        )));
    }

    let fields = content
        .get("fields")
        .ok_or_else(|| TaiError::Decode("missing `fields`".into()))?;

    Ok(LaunchpadConfigView {
        object_id: expected_id,
        admin: parse_addr(fields, "admin")?,
        platform_treasury: parse_addr(fields, "platform_treasury")?,

        trade_fee_bps: parse_u64(fields, "trade_fee_bps")?,
        trade_nav_share_bps: parse_u64(fields, "trade_nav_share_bps")?,
        trade_creator_share_bps: parse_u64(fields, "trade_creator_share_bps")?,
        trade_platform_share_bps: parse_u64(fields, "trade_platform_share_bps")?,

        service_nav_share_bps: parse_u64(fields, "service_nav_share_bps")?,
        service_creator_share_bps: parse_u64(fields, "service_creator_share_bps")?,
        service_platform_share_bps: parse_u64(fields, "service_platform_share_bps")?,

        token_service_nav_share_bps: parse_u64(fields, "token_service_nav_share_bps")?,
        token_service_burn_share_bps: parse_u64(fields, "token_service_burn_share_bps")?,
        token_service_creator_share_bps: parse_u64(fields, "token_service_creator_share_bps")?,

        virtual_sui_reserves: parse_u64(fields, "virtual_sui_reserves")?,
        virtual_token_reserves: parse_u64(fields, "virtual_token_reserves")?,
        sale_supply: parse_u64(fields, "sale_supply")?,
        lp_supply: parse_u64(fields, "lp_supply")?,

        cred_revenue_target: parse_u64(fields, "cred_revenue_target")?,
    })
}

fn parse_u64(fields: &Value, key: &str) -> Result<u64, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field `{}`", key)))?;
    if let Some(n) = v.as_u64() {
        return Ok(n);
    }
    if let Some(s) = v.as_str() {
        return s
            .parse::<u64>()
            .map_err(|e| TaiError::Decode(format!("u64 parse `{}`: {}", key, e)));
    }
    Err(TaiError::Decode(format!(
        "field `{}` is neither u64 nor decimal string",
        key
    )))
}

fn parse_addr(fields: &Value, key: &str) -> Result<SuiAddress, TaiError> {
    let v = fields
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| TaiError::Decode(format!("missing/non-string field `{}`", key)))?;
    v.parse::<SuiAddress>()
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct SuiObjectResponse {
    data: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_launchpad_config_from_fixture() {
        // Captured from `sui client object 0x7aab…c680 --json` after the
        // 2026-05-23 publish. Numeric fields are returned as decimal strings.
        let fixture = json!({
            "data": {
                "content": {
                    "dataType": "moveObject",
                    "fields": {
                        "admin": "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14",
                        "platform_treasury": "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14",
                        "trade_fee_bps": "100",
                        "trade_nav_share_bps": "3000",
                        "trade_creator_share_bps": "6000",
                        "trade_platform_share_bps": "1000",
                        "service_nav_share_bps": "4000",
                        "service_creator_share_bps": "5000",
                        "service_platform_share_bps": "1000",
                        "token_service_nav_share_bps": "4000",
                        "token_service_burn_share_bps": "5000",
                        "token_service_creator_share_bps": "1000",
                        "virtual_sui_reserves": "10000000000000",
                        "virtual_token_reserves": "1073000000000000000",
                        "sale_supply": "800000000000000000",
                        "lp_supply": "200000000000000000",
                        "cred_revenue_target": "1000000000000"
                    }
                }
            }
        });
        let id: ObjectId =
            "0x7aab8b56eceb6d12239ea54d52655c0a35b33bc59bc7c7b2111bbeba0ee6c680"
                .parse()
                .unwrap();
        let cfg = decode_launchpad_config(&fixture, id).unwrap();

        assert_eq!(cfg.trade_fee_bps, 100);
        assert_eq!(cfg.trade_nav_share_bps, 3000);
        assert_eq!(cfg.trade_creator_share_bps, 6000);
        assert_eq!(cfg.trade_platform_share_bps, 1000);
        assert_eq!(cfg.service_nav_share_bps, 4000);
        assert_eq!(cfg.service_creator_share_bps, 5000);
        assert_eq!(cfg.service_platform_share_bps, 1000);
        assert_eq!(cfg.token_service_nav_share_bps, 4000);
        assert_eq!(cfg.token_service_burn_share_bps, 5000);
        assert_eq!(cfg.token_service_creator_share_bps, 1000);
        assert_eq!(cfg.virtual_sui_reserves, 10_000_000_000_000);
        assert_eq!(cfg.virtual_token_reserves, 1_073_000_000_000_000_000);
        assert_eq!(cfg.sale_supply, 800_000_000_000_000_000);
        assert_eq!(cfg.lp_supply, 200_000_000_000_000_000);
        assert_eq!(cfg.cred_revenue_target, 1_000_000_000_000);
        assert_eq!(
            cfg.admin.to_string(),
            "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14"
        );
    }

    #[test]
    fn rejects_non_moveobject() {
        let fixture = json!({
            "data": { "content": { "dataType": "package" } }
        });
        let id = ObjectId::from_bytes([0u8; 32]);
        assert!(decode_launchpad_config(&fixture, id).is_err());
    }

    #[test]
    fn missing_field_is_diagnostic_error() {
        let fixture = json!({
            "data": { "content": { "dataType": "moveObject", "fields": {} } }
        });
        let id = ObjectId::from_bytes([0u8; 32]);
        let err = decode_launchpad_config(&fixture, id).unwrap_err();
        let msg = format!("{}", err);
        assert!(msg.contains("admin"), "got: {}", msg);
    }
}
