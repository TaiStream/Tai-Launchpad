//! WorkOrder<T> — typed read view + status constants.
//!
//! Mirrors the on-chain `tai::work_order` module added in v1.1.0. Read-only
//! today; PTB builders for create/accept/submit-receipt/release/refund/dispute
//! are exposed via `TaiClient` (see `client.rs`).
//!
//! The on-chain object holds `Balance<SUI>` only; the agent's coin type `T`
//! is reflected in the object type (`0xPKG::work_order::WorkOrder<0xCOIN>`).
//! Parsers extract `T` from the `objectType` string when needed.

use crate::error::TaiError;
use crate::ids::ObjectId;
use crate::rpc::RpcClient;
use serde_json::{json, Value};

/// Status constants — must match `tai::work_order` Move constants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum WorkOrderStatus {
    /// Buyer created and locked SUI; payee has not acknowledged.
    New = 0,
    /// Payee accepted via Owner- or OperatorCap.
    Accepted = 1,
    /// Payee submitted proof of delivered work. Dispute window started.
    ReceiptSubmitted = 2,
    /// Funds released to the payee's launchpad account.
    Released = 3,
    /// Funds refunded to the buyer.
    Refunded = 4,
    /// Buyer opened a dispute during the window. Awaits admin resolution.
    Disputed = 5,
}

impl WorkOrderStatus {
    /// Parse an on-chain u8 status code.
    pub fn from_u8(v: u8) -> Result<Self, TaiError> {
        match v {
            0 => Ok(Self::New),
            1 => Ok(Self::Accepted),
            2 => Ok(Self::ReceiptSubmitted),
            3 => Ok(Self::Released),
            4 => Ok(Self::Refunded),
            5 => Ok(Self::Disputed),
            other => Err(TaiError::Decode(format!(
                "unknown WorkOrder status code: {other}"
            ))),
        }
    }

    /// Lowercase string label, useful for CLI output and indexer filters.
    pub fn label(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Accepted => "accepted",
            Self::ReceiptSubmitted => "receipt_submitted",
            Self::Released => "released",
            Self::Refunded => "refunded",
            Self::Disputed => "disputed",
        }
    }
}

/// Read-only snapshot of a `WorkOrder<T>` shared object.
#[derive(Clone, Debug)]
pub struct WorkOrderView {
    /// The work order's ObjectId.
    pub object_id: ObjectId,
    /// Full object type, including the `<T>` parameter.
    pub object_type: String,
    /// Inner `T` extracted from `WorkOrder<T>` — the payee's coin type.
    pub coin_type: String,

    /// Buyer who created the order and locked SUI.
    pub buyer: String,
    /// Payee's LaunchpadAccount<T> id.
    pub payee_launchpad_account_id: ObjectId,
    /// Payee's AgentTreasury<T> id (cross-linkage check at construction).
    pub payee_agent_treasury_id: ObjectId,

    /// MIST of SUI currently locked in the order (may be 0 after settlement).
    pub locked_sui: u64,
    /// Original amount locked at creation.
    pub amount: u64,

    /// Free-form content hash of the work spec.
    pub spec_hash: Vec<u8>,
    /// Off-chain URL to the human-readable spec.
    pub spec_url: String,

    /// Creation time (UNIX ms).
    pub created_at_ms: u64,
    /// Deadline (UNIX ms) for refund eligibility if no receipt yet.
    pub deadline_ms: u64,
    /// Receipt submission time (UNIX ms). 0 if not yet submitted.
    pub receipt_submitted_at_ms: u64,
    /// Length of the post-receipt dispute window (ms).
    pub dispute_window_ms: u64,

    /// Receipt content hash (empty if not submitted).
    pub receipt_hash: Vec<u8>,
    /// Off-chain receipt URL (empty string if not submitted).
    pub receipt_url: String,

    /// Status code parsed into the enum.
    pub status: WorkOrderStatus,
}

impl WorkOrderView {
    /// Fetch a WorkOrder by object id.
    pub async fn fetch(rpc: &RpcClient, object_id: ObjectId) -> Result<Self, TaiError> {
        let params = json!([
            object_id.to_string(),
            { "showContent": true, "showType": true }
        ]);
        let raw: Value = rpc.call("sui_getObject", params).await?;
        decode_work_order(&raw, object_id)
    }
}

fn decode_work_order(raw: &Value, expected_id: ObjectId) -> Result<WorkOrderView, TaiError> {
    let data = raw
        .get("data")
        .ok_or_else(|| TaiError::Decode("missing `data` in getObject".into()))?;
    let content = data
        .get("content")
        .ok_or_else(|| TaiError::Decode("missing `content`".into()))?;
    let data_type = content
        .get("dataType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if data_type != "moveObject" {
        return Err(TaiError::Decode(format!(
            "expected moveObject, got {data_type}"
        )));
    }
    let object_type = content
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| TaiError::Decode("missing object type".into()))?
        .to_string();

    let coin_type = extract_coin_type(&object_type)
        .ok_or_else(|| TaiError::Decode(format!("malformed WorkOrder type: {object_type}")))?;

    let fields = content
        .get("fields")
        .ok_or_else(|| TaiError::Decode("missing `fields`".into()))?;

    let status_u8 = parse_u64_str(fields, "status")? as u8;
    let status = WorkOrderStatus::from_u8(status_u8)?;

    Ok(WorkOrderView {
        object_id: expected_id,
        object_type,
        coin_type,
        buyer: parse_string(fields, "buyer")?,
        payee_launchpad_account_id: parse_id(fields, "payee_launchpad_account_id")?,
        payee_agent_treasury_id: parse_id(fields, "payee_agent_treasury_id")?,
        locked_sui: parse_balance(fields, "locked")?,
        amount: parse_u64_str(fields, "amount")?,
        spec_hash: parse_byte_vec(fields, "spec_hash")?,
        spec_url: parse_string(fields, "spec_url")?,
        created_at_ms: parse_u64_str(fields, "created_at_ms")?,
        deadline_ms: parse_u64_str(fields, "deadline_ms")?,
        receipt_submitted_at_ms: parse_u64_str(fields, "receipt_submitted_at_ms")?,
        dispute_window_ms: parse_u64_str(fields, "dispute_window_ms")?,
        receipt_hash: parse_byte_vec(fields, "receipt_hash")?,
        receipt_url: parse_string(fields, "receipt_url")?,
        status,
    })
}

// ============================================================================
//  Local JSON helpers (kept private — reads.rs has its own copies, but
//  duplicating these tiny helpers avoids cross-module pub visibility churn).
// ============================================================================

fn parse_u64_str(fields: &Value, key: &str) -> Result<u64, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field {key}")))?;
    if let Some(s) = v.as_str() {
        s.parse::<u64>()
            .map_err(|e| TaiError::Decode(format!("field {key} not u64: {e}")))
    } else if let Some(n) = v.as_u64() {
        Ok(n)
    } else {
        Err(TaiError::Decode(format!("field {key} not number-like")))
    }
}

fn parse_string(fields: &Value, key: &str) -> Result<String, TaiError> {
    fields
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| TaiError::Decode(format!("field {key} not a string")))
}

fn parse_id(fields: &Value, key: &str) -> Result<ObjectId, TaiError> {
    use std::str::FromStr;
    let s = parse_string(fields, key)?;
    ObjectId::from_str(&s).map_err(|e| TaiError::Decode(format!("field {key}: {e}")))
}

fn parse_byte_vec(fields: &Value, key: &str) -> Result<Vec<u8>, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field {key}")))?;
    // Sui surface for vector<u8> can be:
    //   - a base64 string (default), or
    //   - a JSON array of numbers.
    if let Some(s) = v.as_str() {
        // Best-effort base64 decode. If it's not valid base64, treat as ASCII.
        use base64ct::{Base64, Encoding};
        match Base64::decode_vec(s) {
            Ok(bytes) => Ok(bytes),
            Err(_) => Ok(s.as_bytes().to_vec()),
        }
    } else if let Some(arr) = v.as_array() {
        let mut out = Vec::with_capacity(arr.len());
        for elem in arr {
            let n = elem
                .as_u64()
                .ok_or_else(|| TaiError::Decode(format!("field {key}: non-u8 element")))?;
            if n > 255 {
                return Err(TaiError::Decode(format!("field {key}: byte >255")));
            }
            out.push(n as u8);
        }
        Ok(out)
    } else {
        Err(TaiError::Decode(format!("field {key}: not bytes")))
    }
}

/// `Balance<SUI>` can show up as either `{ "value": "123" }` or a plain
/// number depending on the RPC view options. Handle both.
fn parse_balance(fields: &Value, key: &str) -> Result<u64, TaiError> {
    let v = fields
        .get(key)
        .ok_or_else(|| TaiError::Decode(format!("missing field {key}")))?;
    if let Some(obj) = v.as_object() {
        if let Some(inner) = obj.get("value") {
            if let Some(s) = inner.as_str() {
                return s
                    .parse::<u64>()
                    .map_err(|e| TaiError::Decode(format!("balance {key}.value: {e}")));
            }
            if let Some(n) = inner.as_u64() {
                return Ok(n);
            }
        }
    }
    if let Some(s) = v.as_str() {
        return s
            .parse::<u64>()
            .map_err(|e| TaiError::Decode(format!("balance {key}: {e}")));
    }
    if let Some(n) = v.as_u64() {
        return Ok(n);
    }
    Err(TaiError::Decode(format!(
        "balance {key}: unrecognized shape"
    )))
}

/// Extract the inner `T` from `0xPKG::work_order::WorkOrder<T>`.
fn extract_coin_type(t: &str) -> Option<String> {
    let lt = t.find('<')?;
    let gt = t.rfind('>')?;
    if gt <= lt + 1 {
        return None;
    }
    Some(t[lt + 1..gt].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_round_trips() {
        for code in 0u8..=5 {
            let s = WorkOrderStatus::from_u8(code).unwrap();
            assert_eq!(s as u8, code);
        }
        assert!(WorkOrderStatus::from_u8(99).is_err());
    }

    #[test]
    fn coin_type_extracted_from_object_type() {
        let t = "0xabc::work_order::WorkOrder<0xdef::larry::LARRY>";
        assert_eq!(extract_coin_type(t).unwrap(), "0xdef::larry::LARRY");
    }

    #[test]
    fn labels_are_lowercase_snake_case() {
        assert_eq!(WorkOrderStatus::New.label(), "new");
        assert_eq!(
            WorkOrderStatus::ReceiptSubmitted.label(),
            "receipt_submitted"
        );
    }
}
