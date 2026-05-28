/**
 * Sui JSON-RPC layer for the sovereign agent. Two surfaces:
 *
 * 1. ServicePaymentEvent verifier (identical to Larry's read-only flow).
 * 2. Transaction submission via `unsafe_moveCall` + `executeTransactionBlock`.
 *    The agent's signer signs the digest; the Worker submits the
 *    pre-built + signed blob.
 *
 * This lets the sovereign agent take actions on chain from its own keys:
 *   - operator_spend_sui from its own treasury (pay third parties)
 *   - accept_work_order_with_operator (acknowledge an escrow hire)
 *   - submit_receipt_with_operator (deliver work in a work order)
 */

import { AgentSigner } from "./signer";

const SERVICE_PAYMENT_EVENT_SUFFIX = "::launchpad::ServicePaymentEvent";

// ─────────────────────────────────────────────────────────────────────────────
//  ServicePaymentEvent verifier
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifiedPayment {
    payer: string;
    suiAmount: number;
    countedTowardCred: boolean;
    newLifetimeRevenueSui: number;
    paymentTimestampMs: number;
}

export interface VerifyOptions {
    rpcUrl: string;
    launchpadAccountId: string;
    minPaymentMist: number;
    freshnessSeconds: number;
    requireExternalPayer?: boolean;
}

export class PaymentVerificationError extends Error {
    constructor(public reason: string, public detail?: unknown) {
        super(`payment verification failed: ${reason}`);
        this.name = "PaymentVerificationError";
    }
}

export async function verifyServicePayment(
    txDigest: string,
    opts: VerifyOptions,
): Promise<VerifiedPayment> {
    const rpc = new SuiRpc(opts.rpcUrl);
    const tx = await rpc.call<any>("sui_getTransactionBlock", [
        txDigest,
        { showEffects: true, showEvents: true },
    ]);

    if (tx?.effects?.status?.status !== "success") {
        throw new PaymentVerificationError("tx not successful", {
            status: tx?.effects?.status?.status,
            error: tx?.effects?.status?.error,
        });
    }
    const events: any[] = tx?.events ?? [];
    const event = events.find(
        (e) =>
            typeof e?.type === "string" &&
            e.type.endsWith(SERVICE_PAYMENT_EVENT_SUFFIX) &&
            e?.parsedJson?.launchpad_id === opts.launchpadAccountId,
    );
    if (!event) {
        throw new PaymentVerificationError(
            "no ServicePaymentEvent for this launchpad in tx",
        );
    }
    const parsed = event.parsedJson;
    const suiAmount = Number(parsed.sui_amount ?? "0");
    if (!Number.isFinite(suiAmount) || suiAmount <= 0) {
        throw new PaymentVerificationError("event has no SUI amount", parsed);
    }
    if (suiAmount < opts.minPaymentMist) {
        throw new PaymentVerificationError(
            `payment too small: ${suiAmount} < ${opts.minPaymentMist} MIST`,
        );
    }
    const countedTowardCred = parsed.counted_toward_cred === true;
    if (opts.requireExternalPayer && !countedTowardCred) {
        throw new PaymentVerificationError(
            "payer is the agent's creator (self-payment); external payer required",
        );
    }
    const paymentTimestampMs = Number(parsed.timestamp ?? "0");
    const ageMs = Date.now() - paymentTimestampMs;
    if (!Number.isFinite(paymentTimestampMs) || paymentTimestampMs <= 0) {
        throw new PaymentVerificationError("event has no timestamp");
    }
    if (ageMs > opts.freshnessSeconds * 1000) {
        throw new PaymentVerificationError(
            `payment too old: ${Math.floor(ageMs / 1000)}s > ${opts.freshnessSeconds}s`,
        );
    }
    return {
        payer: String(parsed.payer),
        suiAmount,
        countedTowardCred,
        newLifetimeRevenueSui: Number(parsed.new_lifetime_revenue_sui ?? "0"),
        paymentTimestampMs,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Transaction submission (signing from the sovereign agent's keys)
// ─────────────────────────────────────────────────────────────────────────────

export interface MoveCallArgs {
    packageId: string;
    module: string;
    function: string;
    /** Fully qualified Sui types, e.g. "0xabc::larry::LARRY". */
    typeArguments: string[];
    /** Sui-pure args + object ids in the order the Move function expects. */
    arguments: unknown[];
    gasBudget: bigint | number;
}

export interface MoveCallResult {
    digest: string;
    rawTransaction: string;
}

export class SuiRpc {
    constructor(private endpoint: string) {}

    async call<R>(method: string, params: unknown): Promise<R> {
        const req = await fetch(this.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        if (!req.ok) {
            const body = await req.text().catch(() => "<unreadable>");
            throw new Error(`sui rpc HTTP ${req.status}: ${body}`);
        }
        const json: any = await req.json();
        if (json?.error) {
            throw new Error(
                `sui rpc ${method} returned ${json.error.code}: ${json.error.message}`,
            );
        }
        return json.result as R;
    }
}

/**
 * Build → sign → execute. Returns the transaction digest on success.
 *
 *   1. unsafe_moveCall builds the TransactionData blob (base64).
 *   2. signer signs intent-prefixed blake2b-256 digest of the blob.
 *   3. sui_executeTransactionBlock submits the signed pair.
 *
 * Errors are surfaced verbatim from the RPC.
 */
export async function submitMoveCall(
    rpcUrl: string,
    signer: AgentSigner,
    call: MoveCallArgs,
): Promise<MoveCallResult> {
    const rpc = new SuiRpc(rpcUrl);

    // Build.
    const built = await rpc.call<{ txBytes: string }>("unsafe_moveCall", [
        signer.identity.address,
        call.packageId,
        call.module,
        call.function,
        call.typeArguments,
        call.arguments,
        null, // gas object id — let RPC pick
        String(call.gasBudget),
    ]);

    // Sign.
    const signature = await signer.signTxBytes(built.txBytes);

    // Execute.
    const exec = await rpc.call<{ digest: string }>("sui_executeTransactionBlock", [
        built.txBytes,
        [signature],
        { showEffects: true },
        "WaitForLocalExecution",
    ]);

    return { digest: exec.digest, rawTransaction: built.txBytes };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Convenience: high-level sovereign operations
// ─────────────────────────────────────────────────────────────────────────────

export interface SovereignContext {
    rpcUrl: string;
    taiPackageId: string;
    taiConfigId: string;
    /** Agent's LaunchpadAccount<T> id. */
    launchpadAccountId: string;
    /** Agent's AgentTreasury<T> id. */
    agentTreasuryId: string;
    /** Agent's OperatorCap<T> id (held by the agent's own address). */
    operatorCapId: string;
    /** Fully-qualified coin type. */
    coinType: string;
    /** Gas budget for outbound calls. */
    gasBudget: bigint | number;
}

/** SUI clock object id — always 0x6 padded. */
export const SUI_CLOCK_OBJECT_ID =
    "0x0000000000000000000000000000000000000000000000000000000000000006";

/**
 * Spend SUI from the agent's own treasury under its OperatorCap.
 * Requires `to` to be in the cap's allowed_targets and the amount to be
 * within today's remaining daily_limit_sui.
 */
export async function spendFromTreasury(
    ctx: SovereignContext,
    signer: AgentSigner,
    amountMist: number | bigint,
    to: string,
): Promise<MoveCallResult> {
    return submitMoveCall(ctx.rpcUrl, signer, {
        packageId: ctx.taiPackageId,
        module: "agent_treasury",
        function: "operator_spend_sui",
        typeArguments: [ctx.coinType],
        arguments: [
            ctx.agentTreasuryId,
            ctx.operatorCapId,
            String(amountMist),
            to,
            SUI_CLOCK_OBJECT_ID,
        ],
        gasBudget: ctx.gasBudget,
    });
}

/**
 * Accept a work order with the agent's OperatorCap.
 */
export async function acceptWorkOrder(
    ctx: SovereignContext,
    signer: AgentSigner,
    workOrderId: string,
): Promise<MoveCallResult> {
    return submitMoveCall(ctx.rpcUrl, signer, {
        packageId: ctx.taiPackageId,
        module: "work_order",
        function: "accept_work_order_with_operator",
        typeArguments: [ctx.coinType],
        arguments: [workOrderId, ctx.operatorCapId, SUI_CLOCK_OBJECT_ID],
        gasBudget: ctx.gasBudget,
    });
}

/**
 * Submit a receipt against a work order with the agent's OperatorCap.
 * `receiptHash` is sent as a JSON byte array.
 */
export async function submitWorkOrderReceipt(
    ctx: SovereignContext,
    signer: AgentSigner,
    workOrderId: string,
    receiptHash: Uint8Array,
    receiptUrl: string,
): Promise<MoveCallResult> {
    return submitMoveCall(ctx.rpcUrl, signer, {
        packageId: ctx.taiPackageId,
        module: "work_order",
        function: "submit_receipt_with_operator",
        typeArguments: [ctx.coinType],
        arguments: [
            workOrderId,
            ctx.operatorCapId,
            Array.from(receiptHash),
            receiptUrl,
            SUI_CLOCK_OBJECT_ID,
        ],
        gasBudget: ctx.gasBudget,
    });
}
