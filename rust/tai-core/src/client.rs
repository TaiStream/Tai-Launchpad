//! High-level write client: ask the RPC to build a Move call, sign the
//! returned transaction digest, submit via `sui_executeTransactionBlock`.
//!
//! Why `unsafe_moveCall`. Building Sui `TransactionData` client-side
//! requires the full Sui type system (one of the larger Rust deps in the
//! ecosystem). For v1, `unsafe_moveCall` (despite the scary name — it
//! refers to the server-trusts-arguments aspect, not to malicious behavior)
//! is supported on all networks and dramatically simplifies the client.
//! When it eventually gets removed we'll swap in BCS construction; the
//! [`TaiClient`] surface stays the same.
//!
//! Wire format:
//!
//! 1. Build: `unsafe_moveCall(signer, pkg, module, function, type_args,
//!    arguments, gas?, gas_budget)` → `{ txBytes: base64 }`.
//! 2. Sign: `intent_message = [0, 0, 0] || tx_bytes`, sign
//!    `blake2b_256(intent_message)` with the signer's key.
//! 3. Execute: `sui_executeTransactionBlock(tx_bytes_base64,
//!    [signature_base64], options, requestType)`.

use crate::config::TaiConfig;
use crate::error::TaiError;
use crate::ids::{ObjectId, SuiAddress};
use crate::rpc::RpcClient;
use crate::signer::Signer;
use base64ct::{Base64, Encoding};
use blake2::{digest::consts::U32, Blake2b, Digest};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

/// Sui's well-known shared Clock object id: `0x0000…06`.
pub const SUI_CLOCK_OBJECT_ID: &str =
    "0x0000000000000000000000000000000000000000000000000000000000000006";

/// Intent prefix bytes for `TransactionData`: `[scope=0, version=0, app=0]`.
const TX_INTENT_PREFIX: [u8; 3] = [0, 0, 0];

/// Default gas budget for client-built calls — 0.1 SUI in MIST. Override via
/// [`MoveCall::gas_budget`].
pub const DEFAULT_GAS_BUDGET_MIST: u64 = 100_000_000;

/// Description of a single Move call. The RPC server builds the
/// `TransactionData` from this plus the signer address.
#[derive(Clone, Debug)]
pub struct MoveCall {
    /// Address of the Move package (the `tai` package on the target network).
    pub package: ObjectId,
    /// Module name within the package, e.g. `"launchpad"`.
    pub module: String,
    /// Function name within the module, e.g. `"record_service_payment_sui"`.
    pub function: String,
    /// Type arguments (instantiates the function's generic parameters).
    ///
    /// Concrete Move type strings, e.g. `"0xabc::larry::LARRY"`.
    pub type_arguments: Vec<String>,
    /// Positional Move arguments. Each argument is serialized as either:
    /// an object id (string), a pure number, a string, an array of pure
    /// values, etc. The RPC server resolves shared object IDs to refs.
    pub arguments: Vec<Value>,
    /// Optional gas object override. `None` lets the RPC pick a coin from
    /// the signer's owned coins.
    pub gas: Option<ObjectId>,
    /// Maximum gas in MIST.
    pub gas_budget: u64,
}

impl MoveCall {
    /// Construct a Move call with the default gas budget and auto-selected gas coin.
    pub fn new(
        package: ObjectId,
        module: impl Into<String>,
        function: impl Into<String>,
    ) -> Self {
        MoveCall {
            package,
            module: module.into(),
            function: function.into(),
            type_arguments: Vec::new(),
            arguments: Vec::new(),
            gas: None,
            gas_budget: DEFAULT_GAS_BUDGET_MIST,
        }
    }

    /// Append a type argument.
    pub fn type_arg(mut self, t: impl Into<String>) -> Self {
        self.type_arguments.push(t.into());
        self
    }

    /// Append a positional argument.
    pub fn arg(mut self, v: Value) -> Self {
        self.arguments.push(v);
        self
    }

    /// Append an object-id argument.
    pub fn arg_object(self, id: ObjectId) -> Self {
        self.arg(json!(id.to_string()))
    }

    /// Append a pure u64 argument (Sui RPC accepts these as numbers).
    pub fn arg_u64(self, n: u64) -> Self {
        self.arg(json!(n))
    }

    /// Append a pure address argument.
    pub fn arg_addr(self, a: SuiAddress) -> Self {
        self.arg(json!(a.to_string()))
    }

    /// Append a pure bool argument.
    pub fn arg_bool(self, b: bool) -> Self {
        self.arg(json!(b))
    }

    /// Append a pure `Option<ID>` argument.
    ///
    /// Sui's RPC format for Move Option arguments is an array:
    /// `[]` for `None`, `[inner]` for `Some(inner)`.
    pub fn arg_option_id(self, opt: Option<ObjectId>) -> Self {
        match opt {
            None => self.arg(json!([])),
            Some(id) => self.arg(json!([id.to_string()])),
        }
    }

    /// Append a pure `vector<address>` argument.
    pub fn arg_vec_addr(self, addrs: &[SuiAddress]) -> Self {
        let items: Vec<String> = addrs.iter().map(|a| a.to_string()).collect();
        self.arg(json!(items))
    }

    /// Append a pure `vector<ID>` argument.
    pub fn arg_vec_id(self, ids: &[ObjectId]) -> Self {
        let items: Vec<String> = ids.iter().map(|i| i.to_string()).collect();
        self.arg(json!(items))
    }

    /// Override the gas budget.
    pub fn with_gas_budget(mut self, gas_budget: u64) -> Self {
        self.gas_budget = gas_budget;
        self
    }
}

/// Trimmed view of `sui_executeTransactionBlock`'s response. Full effects /
/// events / object changes are present in `effects` / `events` /
/// `object_changes` for callers that want to inspect them.
#[derive(Clone, Debug, Deserialize)]
pub struct ExecutionResult {
    /// Transaction digest (base58).
    pub digest: String,
    /// Effects block. Includes `status`, `gasUsed`, etc.
    pub effects: Option<Value>,
    /// Events emitted by the call.
    pub events: Option<Value>,
    /// Created/mutated/deleted objects.
    #[serde(rename = "objectChanges")]
    pub object_changes: Option<Value>,
    /// Per-coin balance changes.
    #[serde(rename = "balanceChanges")]
    pub balance_changes: Option<Value>,
}

impl ExecutionResult {
    /// Returns `Ok(())` if the transaction effects report `status: success`,
    /// otherwise [`TaiError::TxFailed`] with the on-chain error string.
    pub fn check_success(&self) -> Result<(), TaiError> {
        let status = self
            .effects
            .as_ref()
            .and_then(|e| e.get("status"))
            .and_then(|s| s.get("status"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        if status == "success" {
            Ok(())
        } else {
            let err = self
                .effects
                .as_ref()
                .and_then(|e| e.get("status"))
                .and_then(|s| s.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Err(TaiError::TxFailed(format!(
                "tx {} status={} error={}",
                self.digest, status, err
            )))
        }
    }

    /// Convenience: collect created objects of a given Move type from the
    /// `objectChanges` block. Each entry returns the object id string.
    pub fn created_of_type(&self, type_substring: &str) -> Vec<String> {
        let Some(changes) = self.object_changes.as_ref().and_then(|c| c.as_array()) else {
            return Vec::new();
        };
        changes
            .iter()
            .filter(|c| {
                c.get("type").and_then(|t| t.as_str()) == Some("created")
                    && c.get("objectType")
                        .and_then(|t| t.as_str())
                        .is_some_and(|t| t.contains(type_substring))
            })
            .filter_map(|c| {
                c.get("objectId")
                    .and_then(|i| i.as_str())
                    .map(|s| s.to_string())
            })
            .collect()
    }
}

/// What kind of execution receipt the RPC should wait for before returning.
#[derive(Clone, Copy, Debug)]
pub enum RequestType {
    /// Wait until the validator that received the request has locally
    /// executed the transaction. Slowest but safest read-after-write.
    WaitForLocalExecution,
    /// Wait only for the effects certificate. Faster; effects might not be
    /// queryable on every node yet.
    WaitForEffectsCert,
}

impl RequestType {
    fn as_str(self) -> &'static str {
        match self {
            RequestType::WaitForLocalExecution => "WaitForLocalExecution",
            RequestType::WaitForEffectsCert => "WaitForEffectsCert",
        }
    }
}

/// High-level Tai client.
///
/// Wraps a [`RpcClient`] + a [`Signer`] (boxed) + a [`TaiConfig`] (so the
/// package + LaunchpadConfig IDs are always available without re-passing).
pub struct TaiClient {
    rpc: RpcClient,
    config: TaiConfig,
    signer: Arc<dyn Signer>,
}

impl TaiClient {
    /// Construct a client for the given config and signer.
    pub fn new(config: TaiConfig, signer: Arc<dyn Signer>) -> Self {
        let rpc = RpcClient::new(&config.rpc_url);
        TaiClient {
            rpc,
            config,
            signer,
        }
    }

    /// Access the underlying RPC client (e.g. for read calls).
    pub fn rpc(&self) -> &RpcClient {
        &self.rpc
    }

    /// Access the underlying config.
    pub fn config(&self) -> &TaiConfig {
        &self.config
    }

    /// Access the signer's address (the sender of any submitted tx).
    pub fn sender(&self) -> SuiAddress {
        self.signer.address()
    }

    /// Submit an arbitrary Move call as the configured signer.
    ///
    /// Three round-trips to the RPC:
    /// 1. `unsafe_moveCall` to build the unsigned `TransactionData`.
    /// 2. Compute the intent digest locally and sign with [`Signer`].
    /// 3. `sui_executeTransactionBlock` with the signature.
    pub async fn execute_move_call(
        &self,
        call: MoveCall,
        request_type: RequestType,
    ) -> Result<ExecutionResult, TaiError> {
        let sender = self.signer.address();

        // 1. Build.
        let gas_param: Value = match call.gas {
            Some(id) => json!(id.to_string()),
            None => Value::Null,
        };
        let build_params = json!([
            sender.to_string(),
            call.package.to_string(),
            call.module,
            call.function,
            call.type_arguments,
            call.arguments,
            gas_param,
            call.gas_budget.to_string(),
        ]);
        let built: BuiltTransaction = self.rpc.call("unsafe_moveCall", build_params).await?;

        // 2. Sign.
        let tx_bytes = Base64::decode_vec(&built.tx_bytes)
            .map_err(|e| TaiError::Rpc(format!("decode txBytes base64: {e}")))?;
        let digest = transaction_digest(&tx_bytes);
        let signature = self.signer.sign(&digest).await?;
        let sig_b64 = signature.to_base64();

        // 3. Execute.
        let exec_params = json!([
            built.tx_bytes,
            [sig_b64],
            {
                "showEffects": true,
                "showEvents": true,
                "showObjectChanges": true,
                "showBalanceChanges": true
            },
            request_type.as_str(),
        ]);
        let result: ExecutionResult = self
            .rpc
            .call("sui_executeTransactionBlock", exec_params)
            .await?;
        result.check_success()?;
        Ok(result)
    }
}

#[derive(Deserialize)]
struct BuiltTransaction {
    #[serde(rename = "txBytes")]
    tx_bytes: String,
    // gas / inputCoins are also present but we don't need them.
}

/// Compute the digest a Sui validator expects the sender to sign.
///
/// `digest = blake2b_256([0, 0, 0] || tx_bytes)`. The prefix encodes the
/// intent (`TransactionData`, version 0, app Sui).
pub fn transaction_digest(tx_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Blake2b::<U32>::new();
    hasher.update(TX_INTENT_PREFIX);
    hasher.update(tx_bytes);
    let out = hasher.finalize();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&out);
    bytes
}

// ============================================================================
//  Typed write helpers
// ============================================================================

impl TaiClient {
    /// `record_service_payment_sui<T>(config, account, payment, clock)`.
    pub async fn record_service_payment_sui(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        payment_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "record_service_payment_sui")
            .type_arg(coin_type)
            .arg_object(self.config.config_id)
            .arg_object(launchpad_account_id)
            .arg_object(payment_coin_id)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `buy<T>(config, account, payment_coin, min_tokens_out, clock)`.
    pub async fn buy(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        payment_coin_id: ObjectId,
        min_tokens_out: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "buy")
            .type_arg(coin_type)
            .arg_object(self.config.config_id)
            .arg_object(launchpad_account_id)
            .arg_object(payment_coin_id)
            .arg_u64(min_tokens_out)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `sell<T>(config, account, tokens_coin, min_sui_out, clock)`.
    pub async fn sell(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        tokens_coin_id: ObjectId,
        min_sui_out: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "sell")
            .type_arg(coin_type)
            .arg_object(self.config.config_id)
            .arg_object(launchpad_account_id)
            .arg_object(tokens_coin_id)
            .arg_u64(min_sui_out)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_access_config<T>(account, threshold, accept_coin)`. Creator-only.
    pub async fn set_access_config(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        threshold: u64,
        accept_coin_payments: bool,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_access_config")
            .type_arg(coin_type)
            .arg_object(launchpad_account_id)
            .arg_u64(threshold)
            .arg_bool(accept_coin_payments);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `withdraw_sui<T>(treasury, owner_cap, amount, to)`. OwnerCap-gated.
    pub async fn withdraw_sui(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        owner_cap_id: ObjectId,
        amount: u64,
        to: SuiAddress,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "withdraw_sui")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(owner_cap_id)
            .arg_u64(amount)
            .arg_addr(to);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `top_up_sui<T>(treasury, payment)` — permissionless.
    pub async fn top_up_sui(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        payment_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "top_up_sui")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(payment_coin_id);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `top_up_token<T>(treasury, payment)` — permissionless.
    pub async fn top_up_token(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        payment_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "top_up_token")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(payment_coin_id);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `withdraw_token<T>(treasury, owner_cap, amount, to)`. OwnerCap-gated.
    pub async fn withdraw_token(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        owner_cap_id: ObjectId,
        amount: u64,
        to: SuiAddress,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "withdraw_token")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(owner_cap_id)
            .arg_u64(amount)
            .arg_addr(to);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `claim_received_sui<T>(treasury, Receiving<Coin<SUI>>)`.
    ///
    /// The `received_coin_id` argument is the id of a `Coin<SUI>` that has
    /// been transferred-to-object to the treasury's address.
    pub async fn claim_received_sui(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        received_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "claim_received_sui")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(received_coin_id);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `claim_received_token<T>(treasury, Receiving<Coin<T>>)`.
    pub async fn claim_received_token(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        received_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "claim_received_token")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(received_coin_id);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `issue_operator_cap<T>(treasury, owner_cap, recipient, daily_limit_sui,
    /// allowed_targets, ttl_ms, clock)`. OwnerCap-gated.
    pub async fn issue_operator_cap(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        owner_cap_id: ObjectId,
        recipient: SuiAddress,
        daily_limit_sui: u64,
        allowed_targets: &[SuiAddress],
        ttl_ms: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "issue_operator_cap")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(owner_cap_id)
            .arg_addr(recipient)
            .arg_u64(daily_limit_sui)
            .arg_vec_addr(allowed_targets)
            .arg_u64(ttl_ms)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `revoke_operator_cap<T>(treasury, owner_cap, cap_id)`. OwnerCap-gated.
    pub async fn revoke_operator_cap(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        owner_cap_id: ObjectId,
        cap_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "revoke_operator_cap")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(owner_cap_id)
            .arg_object(cap_id);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `operator_spend_sui<T>(treasury, op_cap, amount, to, clock)`.
    /// OperatorCap-gated; subject to Move-enforced policy (revocation, TTL,
    /// allowlist, daily limit).
    pub async fn operator_spend_sui(
        &self,
        coin_type: &str,
        treasury_id: ObjectId,
        operator_cap_id: ObjectId,
        amount: u64,
        to: SuiAddress,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "agent_treasury", "operator_spend_sui")
            .type_arg(coin_type)
            .arg_object(treasury_id)
            .arg_object(operator_cap_id)
            .arg_u64(amount)
            .arg_addr(to)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `record_service_payment_token<T>(config, account, holder, payment, clock)`.
    pub async fn record_service_payment_token(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        treasury_cap_holder_id: ObjectId,
        payment_coin_id: ObjectId,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "record_service_payment_token")
            .type_arg(coin_type)
            .arg_object(self.config.config_id)
            .arg_object(launchpad_account_id)
            .arg_object(treasury_cap_holder_id)
            .arg_object(payment_coin_id)
            .arg(json!(SUI_CLOCK_OBJECT_ID));
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_linked_identity<T>(account, Option<ID>)`. Creator-only.
    pub async fn set_linked_identity(
        &self,
        coin_type: &str,
        launchpad_account_id: ObjectId,
        identity: Option<ObjectId>,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_linked_identity")
            .type_arg(coin_type)
            .arg_object(launchpad_account_id)
            .arg_option_id(identity);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    // ------------------------------------------------------------------
    //  Admin entries on LaunchpadConfig — usable only by the configured admin.
    // ------------------------------------------------------------------

    /// `set_platform_treasury(config, new_treasury)`. Admin-only.
    pub async fn admin_set_platform_treasury(
        &self,
        new_treasury: SuiAddress,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_platform_treasury")
            .arg_object(self.config.config_id)
            .arg_addr(new_treasury);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_trade_shares(config, nav_bps, creator_bps, platform_bps)`. Admin-only.
    pub async fn admin_set_trade_shares(
        &self,
        nav_bps: u64,
        creator_bps: u64,
        platform_bps: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_trade_shares")
            .arg_object(self.config.config_id)
            .arg_u64(nav_bps)
            .arg_u64(creator_bps)
            .arg_u64(platform_bps);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_service_shares(config, nav_bps, creator_bps, platform_bps)`. Admin-only.
    pub async fn admin_set_service_shares(
        &self,
        nav_bps: u64,
        creator_bps: u64,
        platform_bps: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_service_shares")
            .arg_object(self.config.config_id)
            .arg_u64(nav_bps)
            .arg_u64(creator_bps)
            .arg_u64(platform_bps);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_token_service_shares(config, nav_bps, burn_bps, creator_bps)`. Admin-only.
    pub async fn admin_set_token_service_shares(
        &self,
        nav_bps: u64,
        burn_bps: u64,
        creator_bps: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_token_service_shares")
            .arg_object(self.config.config_id)
            .arg_u64(nav_bps)
            .arg_u64(burn_bps)
            .arg_u64(creator_bps);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_trade_fee_bps(config, bps)`. Admin-only.
    pub async fn admin_set_trade_fee_bps(
        &self,
        bps: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_trade_fee_bps")
            .arg_object(self.config.config_id)
            .arg_u64(bps);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `set_cred_revenue_target(config, target)`. Admin-only.
    pub async fn admin_set_cred_revenue_target(
        &self,
        target: u64,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "set_cred_revenue_target")
            .arg_object(self.config.config_id)
            .arg_u64(target);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }

    /// `transfer_admin(config, new_admin)`. Admin-only.
    pub async fn admin_transfer_admin(
        &self,
        new_admin: SuiAddress,
    ) -> Result<ExecutionResult, TaiError> {
        let call = MoveCall::new(self.config.package_id, "launchpad", "transfer_admin")
            .arg_object(self.config.config_id)
            .arg_addr(new_admin);
        self.execute_move_call(call, RequestType::WaitForLocalExecution).await
    }
}

// ============================================================================
//  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signer::Ed25519FileSigner;

    fn cfg() -> TaiConfig {
        TaiConfig::testnet_v1()
    }

    #[test]
    fn move_call_builder_appends_in_order() {
        let pkg: ObjectId = "0x7d41".parse().unwrap();
        let acc: ObjectId = "0xc4a8".parse().unwrap();
        let coin: ObjectId = "0xc01a".parse().unwrap();

        let call = MoveCall::new(pkg, "launchpad", "buy")
            .type_arg("0xabc::larry::LARRY")
            .arg_object(acc)
            .arg_object(coin)
            .arg_u64(123)
            .arg(json!(SUI_CLOCK_OBJECT_ID));

        assert_eq!(call.module, "launchpad");
        assert_eq!(call.function, "buy");
        assert_eq!(call.type_arguments, vec!["0xabc::larry::LARRY"]);
        assert_eq!(call.arguments.len(), 4);
        assert_eq!(call.gas_budget, DEFAULT_GAS_BUDGET_MIST);
    }

    #[test]
    fn transaction_digest_is_blake2b_with_intent_prefix() {
        let tx_bytes = b"hello world";
        let mut hasher = Blake2b::<U32>::new();
        hasher.update([0u8, 0, 0]);
        hasher.update(tx_bytes);
        let expected: [u8; 32] = hasher.finalize().into();
        assert_eq!(transaction_digest(tx_bytes), expected);
    }

    #[test]
    fn execution_result_check_success_when_status_success() {
        let r = ExecutionResult {
            digest: "abc".into(),
            effects: Some(json!({ "status": { "status": "success" } })),
            events: None,
            object_changes: None,
            balance_changes: None,
        };
        assert!(r.check_success().is_ok());
    }

    #[test]
    fn execution_result_check_success_when_status_failure() {
        let r = ExecutionResult {
            digest: "abc".into(),
            effects: Some(json!({
                "status": { "status": "failure", "error": "MoveAbort(EFooBar=42)" }
            })),
            events: None,
            object_changes: None,
            balance_changes: None,
        };
        let err = r.check_success().unwrap_err();
        let msg = format!("{}", err);
        assert!(msg.contains("MoveAbort"), "got: {}", msg);
    }

    #[test]
    fn created_of_type_filters_by_substring() {
        let r = ExecutionResult {
            digest: "x".into(),
            effects: None,
            events: None,
            object_changes: Some(json!([
                { "type": "created", "objectType": "0x..::launchpad::LaunchpadAccount<X>", "objectId": "0xacc" },
                { "type": "created", "objectType": "0x..::agent_treasury::AgentTreasury<X>", "objectId": "0xtreas" },
                { "type": "mutated", "objectType": "0x..::launchpad::LaunchpadAccount<X>", "objectId": "0xmut" }
            ])),
            balance_changes: None,
        };
        let accounts = r.created_of_type("LaunchpadAccount");
        assert_eq!(accounts, vec!["0xacc".to_string()]);
        let treasuries = r.created_of_type("AgentTreasury");
        assert_eq!(treasuries, vec!["0xtreas".to_string()]);
    }

    #[test]
    fn client_exposes_sender_address() {
        let signer = Arc::new(Ed25519FileSigner::from_seed([1u8; 32]));
        let expected = signer.address();
        let client = TaiClient::new(cfg(), signer);
        assert_eq!(client.sender(), expected);
    }

    #[test]
    fn arg_option_id_encodes_none_as_empty_array() {
        let pkg: ObjectId = "0x1".parse().unwrap();
        let call = MoveCall::new(pkg, "launchpad", "set_linked_identity").arg_option_id(None);
        assert_eq!(call.arguments[0], json!([]));
    }

    #[test]
    fn arg_option_id_encodes_some_as_single_element_array() {
        let pkg: ObjectId = "0x1".parse().unwrap();
        let id: ObjectId = "0xfeed".parse().unwrap();
        let call =
            MoveCall::new(pkg, "launchpad", "set_linked_identity").arg_option_id(Some(id));
        let arr = call.arguments[0].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(
            arr[0].as_str().unwrap(),
            "0x000000000000000000000000000000000000000000000000000000000000feed"
        );
    }

    #[test]
    fn arg_vec_addr_encodes_array_of_addresses() {
        let pkg: ObjectId = "0x1".parse().unwrap();
        let a: SuiAddress = "0xab".parse().unwrap();
        let b: SuiAddress = "0xcd".parse().unwrap();
        let call = MoveCall::new(pkg, "agent_treasury", "issue_operator_cap")
            .arg_vec_addr(&[a, b]);
        let arr = call.arguments[0].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr[0].as_str().unwrap().ends_with("ab"));
        assert!(arr[1].as_str().unwrap().ends_with("cd"));
    }

    #[test]
    fn arg_vec_id_encodes_array_of_ids() {
        let pkg: ObjectId = "0x1".parse().unwrap();
        let a: ObjectId = "0xa1".parse().unwrap();
        let b: ObjectId = "0xb2".parse().unwrap();
        let call =
            MoveCall::new(pkg, "agent_treasury", "issue_operator_cap").arg_vec_id(&[a, b]);
        let arr = call.arguments[0].as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn issue_operator_cap_builds_expected_argument_layout() {
        // Sanity-check the helper produces the right 7-positional-arg shape.
        let signer = Arc::new(Ed25519FileSigner::from_seed([1u8; 32]));
        let client = TaiClient::new(cfg(), signer);

        // Build the MoveCall directly to inspect its shape.
        let treasury: ObjectId = "0xaaaa".parse().unwrap();
        let owner_cap: ObjectId = "0xbbbb".parse().unwrap();
        let recipient: SuiAddress = "0xcc01".parse().unwrap();
        let allowed: SuiAddress = "0xdd01".parse().unwrap();

        let call = MoveCall::new(
            client.config().package_id,
            "agent_treasury",
            "issue_operator_cap",
        )
        .type_arg("0xabc::larry::LARRY")
        .arg_object(treasury)
        .arg_object(owner_cap)
        .arg_addr(recipient)
        .arg_u64(10_000_000_000)
        .arg_vec_addr(&[allowed])
        .arg_u64(30 * 86_400_000)
        .arg(json!(SUI_CLOCK_OBJECT_ID));

        assert_eq!(call.arguments.len(), 7);
        assert_eq!(call.type_arguments, vec!["0xabc::larry::LARRY"]);
        // arg 4 (zero-indexed) is the allowlist vector
        assert!(call.arguments[4].is_array());
    }
}
