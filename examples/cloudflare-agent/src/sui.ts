/**
 * Minimal Sui JSON-RPC client + ServicePaymentEvent verifier. Mirrors the
 * read-side helpers in tai-core but in TypeScript so the Worker has no
 * native deps. We're only doing reads here — no signing, no tx construction
 * — so this is the entire surface we need.
 */

const SERVICE_PAYMENT_EVENT_SUFFIX = "::launchpad::ServicePaymentEvent";

export interface VerifiedPayment {
    /** Sui address that paid. */
    payer: string;
    /** Amount in MIST. */
    suiAmount: number;
    /** Whether Tai counted this toward the cred multiplier. False for
     *  self-payments (payer === account.creator). */
    countedTowardCred: boolean;
    /** Lifetime SUI revenue AFTER this payment, as reported by the event. */
    newLifetimeRevenueSui: number;
    /** Move-side `clock::timestamp_ms` at the payment. */
    paymentTimestampMs: number;
}

export interface VerifyOptions {
    /** Sui JSON-RPC endpoint. */
    rpcUrl: string;
    /** LaunchpadAccount<T> object id the payment must reference. */
    launchpadAccountId: string;
    /** Minimum acceptable payment in MIST. */
    minPaymentMist: number;
    /** Max age of the payment in seconds (anti-replay-ish). */
    freshnessSeconds: number;
    /** Optional: require counted_toward_cred == true (rejects self-payments). */
    requireExternalPayer?: boolean;
}

export class PaymentVerificationError extends Error {
    constructor(public reason: string, public detail?: unknown) {
        super(`payment verification failed: ${reason}`);
        this.name = "PaymentVerificationError";
    }
}

/**
 * Verify that the given on-chain tx contains a successful
 * ServicePaymentEvent targeting our launchpad account with at least
 * minPaymentMist SUI within freshnessSeconds.
 *
 * Throws PaymentVerificationError on any mismatch.
 */
export async function verifyServicePayment(
    txDigest: string,
    opts: VerifyOptions,
): Promise<VerifiedPayment> {
    const rpc = new SuiRpc(opts.rpcUrl);
    const tx = await rpc.call<any>("sui_getTransactionBlock", [
        txDigest,
        {
            showEffects: true,
            showEvents: true,
        },
    ]);

    // 1. Tx must have executed successfully.
    const status = tx?.effects?.status?.status;
    if (status !== "success") {
        throw new PaymentVerificationError("tx not successful", {
            status,
            error: tx?.effects?.status?.error,
        });
    }

    // 2. Find the ServicePaymentEvent for our launchpad account.
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
            { launchpad_id: opts.launchpadAccountId, eventCount: events.length },
        );
    }

    const parsed = event.parsedJson;
    const suiAmount = Number(parsed.sui_amount ?? "0");
    if (!Number.isFinite(suiAmount) || suiAmount <= 0) {
        throw new PaymentVerificationError("event has no SUI amount", parsed);
    }

    // 3. Minimum amount.
    if (suiAmount < opts.minPaymentMist) {
        throw new PaymentVerificationError(
            `payment too small: ${suiAmount} < ${opts.minPaymentMist} MIST`,
        );
    }

    // 4. Optional: reject self-payments (creator paying themselves).
    const countedTowardCred = parsed.counted_toward_cred === true;
    if (opts.requireExternalPayer && !countedTowardCred) {
        throw new PaymentVerificationError(
            "payer is the agent's creator (self-payment); external payer required",
        );
    }

    // 5. Freshness check.
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

class SuiRpc {
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
