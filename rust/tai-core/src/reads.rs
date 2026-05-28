//! Read-side views over the on-chain Tai objects.
//!
//! Every Move struct field is mirrored as a typed Rust field. Sui returns
//! numerics as decimal strings inside `Move struct JSON`; we parse them to
//! `u64`/`u128` here so callers get strongly-typed values.

use crate::error::TaiError;
use crate::ids::{ObjectId, SuiAddress};
use crate::rpc::RpcClient;
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

fn decode_launchpad_config(
    raw: &Value,
    expected_id: ObjectId,
) -> Result<LaunchpadConfigView, TaiError> {
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

fn parse_object_id(fields: &Value, key: &str) -> Result<ObjectId, TaiError> {
    let v = fields
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| TaiError::Decode(format!("missing/non-string field `{}`", key)))?;
    v.parse::<ObjectId>()
}

fn parse_bool(fields: &Value, key: &str) -> Result<bool, TaiError> {
    fields
        .get(key)
        .and_then(|v| v.as_bool())
        .ok_or_else(|| TaiError::Decode(format!("missing/non-bool field `{}`", key)))
}

fn parse_u8(fields: &Value, key: &str) -> Result<u8, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field `{}`", key)))?;
    if let Some(n) = v.as_u64() {
        return u8::try_from(n).map_err(|_| TaiError::Decode(format!("u8 overflow on `{}`", key)));
    }
    if let Some(s) = v.as_str() {
        return s
            .parse::<u8>()
            .map_err(|e| TaiError::Decode(format!("u8 parse `{}`: {}", key, e)));
    }
    Err(TaiError::Decode(format!(
        "field `{}` is neither u8 nor decimal string",
        key
    )))
}

fn parse_string(fields: &Value, key: &str) -> Result<String, TaiError> {
    fields
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| TaiError::Decode(format!("missing/non-string field `{}`", key)))
}

/// Sui renders `Balance<T>` as `{ "value": "..." }`. Some RPC versions
/// flatten it to a direct decimal string — handle both.
fn parse_balance(fields: &Value, key: &str) -> Result<u64, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field `{}`", key)))?;
    if let Some(inner) = v.get("value") {
        return parse_u64_value(inner, key);
    }
    if let Some(inner) = v.get("fields").and_then(|f| f.get("value")) {
        return parse_u64_value(inner, key);
    }
    parse_u64_value(v, key)
}

fn parse_u64_value(v: &Value, key: &str) -> Result<u64, TaiError> {
    if let Some(n) = v.as_u64() {
        return Ok(n);
    }
    if let Some(s) = v.as_str() {
        return s
            .parse::<u64>()
            .map_err(|e| TaiError::Decode(format!("u64 parse `{}`: {}", key, e)));
    }
    Err(TaiError::Decode(format!(
        "field `{}` is neither u64 nor decimal string (got {:?})",
        key, v
    )))
}

/// Sui renders `Option<T>` as `{ "vec": [] }` (None) or `{ "vec": [v] }` (Some).
fn parse_option_object_id(fields: &Value, key: &str) -> Result<Option<ObjectId>, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field `{}`", key)))?;
    if v.is_null() {
        return Ok(None);
    }
    let vec = v
        .get("vec")
        .and_then(|x| x.as_array())
        .ok_or_else(|| TaiError::Decode(format!("`{}` is not an Option (no `vec` array)", key)))?;
    match vec.len() {
        0 => Ok(None),
        1 => {
            let s = vec[0]
                .as_str()
                .ok_or_else(|| TaiError::Decode(format!("`{}` inner is not a string", key)))?;
            Ok(Some(s.parse::<ObjectId>()?))
        }
        n => Err(TaiError::Decode(format!(
            "Option `{}` has {} entries; expected 0 or 1",
            key, n
        ))),
    }
}

fn parse_vec_object_id(fields: &Value, key: &str) -> Result<Vec<ObjectId>, TaiError> {
    let arr = fields
        .get(key)
        .and_then(|v| v.as_array())
        .ok_or_else(|| TaiError::Decode(format!("missing/non-array field `{}`", key)))?;
    arr.iter()
        .enumerate()
        .map(|(i, v)| {
            v.as_str()
                .ok_or_else(|| TaiError::Decode(format!("`{}`[{}] not a string", key, i)))
                .and_then(|s| s.parse::<ObjectId>())
        })
        .collect()
}

// ============================================================================
//  LaunchpadAccountView
// ============================================================================

/// Strongly-typed mirror of `tai::launchpad::LaunchpadAccount<T>`.
///
/// All balance fields are returned as plain `u64`. The generic coin type `T`
/// is identified by [`coin_type`](LaunchpadAccountView::coin_type) (the Move
/// type string).
#[derive(Clone, Debug)]
pub struct LaunchpadAccountView {
    /// On-chain object ID of the LaunchpadAccount.
    pub object_id: ObjectId,
    /// Concrete type parameter for `T`, e.g. `0xabc::larry::LARRY`.
    pub coin_type: String,

    /// Fee-receiving wallet snapshotted at launch.
    pub creator: SuiAddress,
    /// Optional pointer to an external identity object (e.g. SAI AgentIdentity).
    pub linked_identity: Option<ObjectId>,
    /// Display name carried on the launch event.
    pub coin_type_name: String,
    /// Total supply minted at launch (sale + lp).
    pub total_supply: u64,
    /// Coin decimals — 9 in v1.
    pub decimals: u8,

    /// Real SUI in the bonding-curve pool (excludes virtual reserves + NAV).
    pub real_sui: u64,
    /// Real T tokens left in the bonding curve.
    pub real_token: u64,
    /// Virtual SUI reserves, snapshotted at launch (immutable).
    pub virtual_sui_reserves: u64,
    /// Virtual token reserves, snapshotted at launch (immutable).
    pub virtual_token_reserves: u64,

    /// LP reserve — locked permanently in v1.
    pub lp_reserve: u64,

    /// NAV in SUI. Non-withdrawable.
    pub nav_sui: u64,
    /// NAV in T (from token-denominated service payments).
    pub nav_token: u64,

    /// Token-holding threshold for token-gated services (0 = open).
    pub access_threshold: u64,
    /// Whether the agent opts in to coin-denominated hire payments.
    pub accept_coin_payments: bool,
    /// Cumulative SUI service revenue (drives the cred multiplier).
    pub lifetime_service_revenue_sui: u64,
    /// Saturation target snapshotted at launch.
    pub cred_revenue_target: u64,

    // Sibling-object linkage
    /// Linked TreasuryCapHolder<T> object.
    pub treasury_cap_holder_id: ObjectId,
    /// Linked AgentTreasury<T> object.
    pub agent_treasury_id: ObjectId,
    /// OwnerCap<T> minted at launch.
    pub owner_cap_id: ObjectId,
    /// Reserved for v1.1 Ika adapter. None on v1 launches.
    pub dwallets_object_id: Option<ObjectId>,

    // Counters
    /// Total successful buys executed on this agent.
    pub total_buys: u64,
    /// Total successful sells.
    pub total_sells: u64,
    /// Total SUI-denominated service payments recorded.
    pub total_service_payments_sui: u64,
    /// Total token-denominated service payments recorded.
    pub total_service_payments_token: u64,
    /// Sum of `sui_in` (buy) and `sui_gross` (sell) across all trades.
    pub cumulative_volume_sui: u64,
    /// Sum of trade fees collected across all trades.
    pub cumulative_fees_sui: u64,
    /// Clock timestamp_ms at launch.
    pub launched_at: u64,
}

impl LaunchpadAccountView {
    /// Fetch a LaunchpadAccount from the given RPC by object ID.
    pub async fn fetch(rpc: &RpcClient, object_id: ObjectId) -> Result<Self, TaiError> {
        let params = json!([
            object_id.to_string(),
            { "showContent": true, "showType": true }
        ]);
        let raw: Value = rpc.call("sui_getObject", params).await?;
        decode_launchpad_account(&raw, object_id)
    }
}

fn decode_launchpad_account(
    raw: &Value,
    expected_id: ObjectId,
) -> Result<LaunchpadAccountView, TaiError> {
    let data = raw
        .get("data")
        .ok_or_else(|| TaiError::Decode("missing `data`".into()))?;

    // Sui's `type` looks like
    //   `0x<pkg>::launchpad::LaunchpadAccount<0x<coin_pkg>::larry::LARRY>`
    let full_type = data
        .get("type")
        .and_then(|v| v.as_str())
        .or_else(|| {
            data.get("content")
                .and_then(|c| c.get("type"))
                .and_then(|v| v.as_str())
        })
        .ok_or_else(|| TaiError::Decode("missing `type` on object".into()))?;
    let coin_type = extract_generic_argument(full_type).unwrap_or_default();

    let content = data
        .get("content")
        .ok_or_else(|| TaiError::Decode("missing `content`".into()))?;
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

    Ok(LaunchpadAccountView {
        object_id: expected_id,
        coin_type,

        creator: parse_addr(fields, "creator")?,
        linked_identity: parse_option_object_id(fields, "linked_identity")?,
        coin_type_name: parse_string(fields, "coin_type_name")?,
        total_supply: parse_u64(fields, "total_supply")?,
        decimals: parse_u8(fields, "decimals")?,

        real_sui: parse_balance(fields, "real_sui_balance")?,
        real_token: parse_balance(fields, "real_token_balance")?,
        virtual_sui_reserves: parse_u64(fields, "virtual_sui_reserves")?,
        virtual_token_reserves: parse_u64(fields, "virtual_token_reserves")?,

        lp_reserve: parse_balance(fields, "lp_reserve")?,

        nav_sui: parse_balance(fields, "nav_sui")?,
        nav_token: parse_balance(fields, "nav_token")?,

        access_threshold: parse_u64(fields, "access_threshold")?,
        accept_coin_payments: parse_bool(fields, "accept_coin_payments")?,
        lifetime_service_revenue_sui: parse_u64(fields, "lifetime_service_revenue_sui")?,
        cred_revenue_target: parse_u64(fields, "cred_revenue_target")?,

        treasury_cap_holder_id: parse_object_id(fields, "treasury_cap_holder_id")?,
        agent_treasury_id: parse_object_id(fields, "agent_treasury_id")?,
        owner_cap_id: parse_object_id(fields, "owner_cap_id")?,
        dwallets_object_id: parse_option_object_id(fields, "dwallets_object_id")?,

        total_buys: parse_u64(fields, "total_buys")?,
        total_sells: parse_u64(fields, "total_sells")?,
        total_service_payments_sui: parse_u64(fields, "total_service_payments_sui")?,
        total_service_payments_token: parse_u64(fields, "total_service_payments_token")?,
        cumulative_volume_sui: parse_u64(fields, "cumulative_volume_sui")?,
        cumulative_fees_sui: parse_u64(fields, "cumulative_fees_sui")?,
        launched_at: parse_u64(fields, "launched_at")?,
    })
}

fn extract_generic_argument(type_str: &str) -> Option<String> {
    let lt = type_str.find('<')?;
    let gt = type_str.rfind('>')?;
    if gt <= lt {
        return None;
    }
    Some(type_str[lt + 1..gt].to_string())
}

// ============================================================================
//  AgentTreasuryView
// ============================================================================

/// Strongly-typed mirror of `tai::agent_treasury::AgentTreasury<T>`.
#[derive(Clone, Debug)]
pub struct AgentTreasuryView {
    /// On-chain object id.
    pub object_id: ObjectId,
    /// Linked LaunchpadAccount<T>.
    pub launchpad_account_id: ObjectId,
    /// OwnerCap<T> that gates this treasury.
    pub owner_cap_id: ObjectId,
    /// Currently-active OperatorCap ids (revoked caps are removed).
    pub active_operator_cap_ids: Vec<ObjectId>,
    /// SUI working capital.
    pub sui_balance: u64,
    /// Token working capital (in T).
    pub token_balance: u64,
}

impl AgentTreasuryView {
    /// Fetch an AgentTreasury from the given RPC by object ID.
    pub async fn fetch(rpc: &RpcClient, object_id: ObjectId) -> Result<Self, TaiError> {
        let params = json!([
            object_id.to_string(),
            { "showContent": true, "showType": true }
        ]);
        let raw: Value = rpc.call("sui_getObject", params).await?;
        decode_agent_treasury(&raw, object_id)
    }
}

fn decode_agent_treasury(
    raw: &Value,
    expected_id: ObjectId,
) -> Result<AgentTreasuryView, TaiError> {
    let data = raw
        .get("data")
        .ok_or_else(|| TaiError::Decode("missing `data`".into()))?;
    let content = data
        .get("content")
        .ok_or_else(|| TaiError::Decode("missing `content`".into()))?;
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

    Ok(AgentTreasuryView {
        object_id: expected_id,
        launchpad_account_id: parse_object_id(fields, "launchpad_account_id")?,
        owner_cap_id: parse_object_id(fields, "owner_cap_id")?,
        active_operator_cap_ids: parse_vec_object_id(fields, "active_operator_cap_ids")?,
        sui_balance: parse_balance(fields, "sui_balance")?,
        token_balance: parse_balance(fields, "token_balance")?,
    })
}

// ============================================================================
//  hire_quote — client-side computation matching views::hire_quote
// ============================================================================

/// Output of [`hire_quote`]. Matches `views::hire_quote<T>` on-chain so the
/// CLI/SDK produces identical values whether reading from chain or
/// computing locally from a [`LaunchpadAccountView`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HireQuote {
    /// Accumulated SUI NAV.
    pub nav_sui: u64,
    /// Cumulative SUI service revenue (excludes self-payments).
    pub lifetime_service_revenue_sui: u64,
    /// Cred saturation target snapshotted at launch.
    pub cred_revenue_target: u64,
    /// Cred multiplier in basis points. 10_000 = 1.0x, 20_000 = 2.0x (cap).
    pub multiplier_bps: u64,
    /// Recommended hire price in MIST.
    pub hire_price_sui: u64,
}

/// Compute the cred-adjusted hire price from an account view.
///
/// Matches Move-side `views::hire_quote` byte-for-byte:
/// ```text
/// bonus       = min(10_000, earned * 10_000 / target)
/// mult_bps    = 10_000 + bonus
/// hire_price  = nav * mult_bps / 10_000
/// ```
pub fn hire_quote(account: &LaunchpadAccountView) -> HireQuote {
    const BPS: u128 = 10_000;
    const BPS_CAP: u128 = 10_000;

    let nav = account.nav_sui as u128;
    let earned = account.lifetime_service_revenue_sui as u128;
    let target = account.cred_revenue_target.max(1) as u128;

    let bonus = (earned * BPS) / target;
    let capped_bonus = bonus.min(BPS_CAP);
    let mult_bps = BPS + capped_bonus;
    let hire_price = nav * mult_bps / BPS;

    HireQuote {
        nav_sui: account.nav_sui,
        lifetime_service_revenue_sui: account.lifetime_service_revenue_sui,
        cred_revenue_target: account.cred_revenue_target,
        multiplier_bps: mult_bps as u64,
        hire_price_sui: hire_price as u64,
    }
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
        let id: ObjectId = "0x7aab8b56eceb6d12239ea54d52655c0a35b33bc59bc7c7b2111bbeba0ee6c680"
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

    // ==========================================================
    //  LaunchpadAccountView
    // ==========================================================

    fn launchpad_account_fixture() -> Value {
        json!({
            "data": {
                "type": "0x7d41072ae77b18b752292b47468e07e6332cd9a6ef9b052752f98f22d9844f8d::launchpad::LaunchpadAccount<0xabc0000000000000000000000000000000000000000000000000000000000abc::larry::LARRY>",
                "content": {
                    "dataType": "moveObject",
                    "fields": {
                        "creator": "0x2ce41c43a6ee1192adc2fe6cc620eef80ca4f57940a5c6cc2d51664514616c14",
                        "linked_identity": { "vec": [] },
                        "coin_type_name": "0xabc::larry::LARRY",
                        "total_supply": "1000000000000000000",
                        "decimals": 9,

                        "real_sui_balance": { "value": "990000000" },
                        "real_token_balance": { "value": "799814591355455809" },
                        "virtual_sui_reserves": "10000000000000",
                        "virtual_token_reserves": "1073000000000000000",

                        "lp_reserve": { "value": "200000000000000000" },

                        "nav_sui": { "value": "3000000" },
                        "nav_token": { "value": "0" },

                        "access_threshold": "0",
                        "accept_coin_payments": false,
                        "lifetime_service_revenue_sui": "0",
                        "cred_revenue_target": "1000000000000",

                        "treasury_cap_holder_id": "0x1111111111111111111111111111111111111111111111111111111111111111",
                        "agent_treasury_id": "0x2222222222222222222222222222222222222222222222222222222222222222",
                        "owner_cap_id": "0x3333333333333333333333333333333333333333333333333333333333333333",
                        "dwallets_object_id": { "vec": [] },

                        "total_buys": "1",
                        "total_sells": "0",
                        "total_service_payments_sui": "0",
                        "total_service_payments_token": "0",
                        "cumulative_volume_sui": "1000000000",
                        "cumulative_fees_sui": "10000000",
                        "launched_at": "1779568299473"
                    }
                }
            }
        })
    }

    #[test]
    fn decode_launchpad_account_full_shape() {
        let id: ObjectId = "0xc4a8".parse().unwrap();
        let acc = decode_launchpad_account(&launchpad_account_fixture(), id).unwrap();

        assert_eq!(acc.object_id, id);
        assert!(acc.coin_type.contains("::larry::LARRY"));
        assert_eq!(acc.coin_type_name, "0xabc::larry::LARRY");
        assert_eq!(acc.total_supply, 1_000_000_000_000_000_000);
        assert_eq!(acc.decimals, 9);

        // Balance fields parsed correctly.
        assert_eq!(acc.real_sui, 990_000_000);
        assert_eq!(acc.real_token, 799_814_591_355_455_809);
        assert_eq!(acc.lp_reserve, 200_000_000_000_000_000);
        assert_eq!(acc.nav_sui, 3_000_000);
        assert_eq!(acc.nav_token, 0);

        assert_eq!(acc.access_threshold, 0);
        assert!(!acc.accept_coin_payments);
        assert_eq!(acc.lifetime_service_revenue_sui, 0);
        assert_eq!(acc.cred_revenue_target, 1_000_000_000_000);

        // Optional<ID> rendered as { vec: [] } = None.
        assert_eq!(acc.linked_identity, None);
        assert_eq!(acc.dwallets_object_id, None);

        assert_eq!(acc.total_buys, 1);
        assert_eq!(acc.cumulative_volume_sui, 1_000_000_000);
    }

    #[test]
    fn decode_launchpad_account_with_linked_identity_some() {
        let mut fixture = launchpad_account_fixture();
        fixture["data"]["content"]["fields"]["linked_identity"] = json!({
            "vec": ["0xfeed"]
        });
        let id: ObjectId = "0xc4a8".parse().unwrap();
        let acc = decode_launchpad_account(&fixture, id).unwrap();
        assert!(acc.linked_identity.is_some());
    }

    // ==========================================================
    //  AgentTreasuryView
    // ==========================================================

    #[test]
    fn decode_agent_treasury_view() {
        let fixture = json!({
            "data": {
                "content": {
                    "dataType": "moveObject",
                    "fields": {
                        "launchpad_account_id": "0xaaaa",
                        "owner_cap_id": "0xbbbb",
                        "active_operator_cap_ids": [
                            "0xccc1",
                            "0xccc2"
                        ],
                        "sui_balance": { "value": "5000000000" },
                        "token_balance": { "value": "1500000" }
                    }
                }
            }
        });
        let id: ObjectId = "0x7777".parse().unwrap();
        let t = decode_agent_treasury(&fixture, id).unwrap();
        assert_eq!(t.object_id, id);
        assert_eq!(t.sui_balance, 5_000_000_000);
        assert_eq!(t.token_balance, 1_500_000);
        assert_eq!(t.active_operator_cap_ids.len(), 2);
    }

    // ==========================================================
    //  hire_quote — matches Move-side views::hire_quote
    // ==========================================================

    fn account_with(nav: u64, earned: u64, target: u64) -> LaunchpadAccountView {
        LaunchpadAccountView {
            object_id: ObjectId::from_bytes([0u8; 32]),
            coin_type: "x".into(),
            creator: SuiAddress::ZERO,
            linked_identity: None,
            coin_type_name: "x".into(),
            total_supply: 0,
            decimals: 9,
            real_sui: 0,
            real_token: 0,
            virtual_sui_reserves: 0,
            virtual_token_reserves: 0,
            lp_reserve: 0,
            nav_sui: nav,
            nav_token: 0,
            access_threshold: 0,
            accept_coin_payments: false,
            lifetime_service_revenue_sui: earned,
            cred_revenue_target: target,
            treasury_cap_holder_id: ObjectId::from_bytes([0u8; 32]),
            agent_treasury_id: ObjectId::from_bytes([0u8; 32]),
            owner_cap_id: ObjectId::from_bytes([0u8; 32]),
            dwallets_object_id: None,
            total_buys: 0,
            total_sells: 0,
            total_service_payments_sui: 0,
            total_service_payments_token: 0,
            cumulative_volume_sui: 0,
            cumulative_fees_sui: 0,
            launched_at: 0,
        }
    }

    #[test]
    fn hire_quote_zero_revenue_is_one_x() {
        let q = hire_quote(&account_with(1_000_000, 0, 1_000_000_000_000));
        assert_eq!(q.multiplier_bps, 10_000);
        assert_eq!(q.hire_price_sui, 1_000_000);
    }

    #[test]
    fn hire_quote_at_target_doubles_nav() {
        let q = hire_quote(&account_with(
            1_000_000,
            1_000_000_000_000,
            1_000_000_000_000,
        ));
        assert_eq!(q.multiplier_bps, 20_000);
        assert_eq!(q.hire_price_sui, 2_000_000);
    }

    #[test]
    fn hire_quote_above_target_saturates_at_two_x() {
        let q = hire_quote(&account_with(
            1_000_000,
            5_000_000_000_000,
            1_000_000_000_000,
        ));
        assert_eq!(q.multiplier_bps, 20_000);
        assert_eq!(q.hire_price_sui, 2_000_000);
    }

    #[test]
    fn hire_quote_partial_revenue_is_linear() {
        // 25% of target -> bonus 2500 -> mult 12500.
        let q = hire_quote(&account_with(1_000_000, 250_000_000_000, 1_000_000_000_000));
        assert_eq!(q.multiplier_bps, 12_500);
        assert_eq!(q.hire_price_sui, 1_250_000);
    }
}
