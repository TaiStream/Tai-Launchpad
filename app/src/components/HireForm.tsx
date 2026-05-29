"use client";

import { useState } from "react";
import {
    useCurrentAccount,
    useSignAndExecuteTransaction,
    useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { TAI, suiscan } from "@/lib/config";
import { mistToSui } from "@/lib/format";

/**
 * Inline hire form on the agent dashboard. Builds a one-PTB transaction:
 *   1. tx.splitCoins(tx.gas, [amount])  → freshly-split SUI coin
 *   2. tx.moveCall work_order::create_work_order<T>(
 *        payee_account, payment_coin, spec_hash, spec_url,
 *        deadline_ms, dispute_window_ms, clock
 *      )
 *
 * Submits via the connected wallet. On success, surfaces the tx digest + a
 * link to suiscan. The dashboard's AutoRefresh picks up the new work order
 * within ~15s.
 */

const ONE_HOUR_MS = 3_600_000;

export default function HireForm({
    launchpadAccountId,
    coinType,
    suggestedHirePriceMist,
}: {
    launchpadAccountId: string;
    coinType: string;
    suggestedHirePriceMist: bigint;
}) {
    const account = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

    // Default the amount to the suggested hire price (or 0.1 SUI if zero).
    const defaultSui =
        suggestedHirePriceMist > 0n
            ? mistToSui(suggestedHirePriceMist, 3)
            : "0.100";

    const [amountSui, setAmountSui] = useState(defaultSui);
    const [specUrl, setSpecUrl] = useState("");
    const [deadlineHours, setDeadlineHours] = useState("24");
    const [disputeHours, setDisputeHours] = useState("1");
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{
        ok: boolean;
        digest?: string;
        error?: string;
    } | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!account) return;
        setResult(null);
        setSubmitting(true);
        try {
            const amountMist = parseSuiToMist(amountSui);
            if (amountMist <= 0n) throw new Error("amount must be > 0");

            const deadline =
                BigInt(Date.now()) +
                BigInt(Math.max(1, Number(deadlineHours))) * BigInt(ONE_HOUR_MS);
            const disputeWindow =
                BigInt(Math.max(0, Number(disputeHours))) * BigInt(ONE_HOUR_MS);

            const tx = new Transaction();
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
            tx.moveCall({
                target: `${TAI.v1_1.packageId}::work_order::create_work_order`,
                typeArguments: [coinType],
                arguments: [
                    tx.object(launchpadAccountId),
                    coin,
                    tx.pure.vector("u8", []), // empty spec hash for the inline form
                    tx.pure.string(specUrl),
                    tx.pure.u64(deadline),
                    tx.pure.u64(disputeWindow),
                    tx.object("0x6"), // SUI clock
                ],
            });

            await new Promise<void>((resolve, reject) => {
                signAndExecute(
                    { transaction: tx },
                    {
                        onSuccess: ({ digest }) => {
                            setResult({ ok: true, digest });
                            resolve();
                        },
                        onError: (err: unknown) => {
                            setResult({
                                ok: false,
                                error: errorMessage(err),
                            });
                            reject(err);
                        },
                    },
                );
            });
        } catch (err) {
            setResult({ ok: false, error: errorMessage(err) });
        } finally {
            setSubmitting(false);
        }
    }

    if (!account) {
        return (
            <div className="border border-dashed border-border-bright bg-surface/40 p-5 text-[12.5px] text-phosphor-dim">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-phosphor-faint">
                    hire from your wallet
                </div>
                Connect a Sui wallet (top-right) to lock SUI into an escrowed
                work order. Until then you can still hire from the CLI:{" "}
                <code className="text-amber-bright">tai hire --agent {short(launchpadAccountId)} ...</code>
            </div>
        );
    }

    const suggested = mistToSui(suggestedHirePriceMist, 3);

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            {/* Amount, with one-tap fill to the agent's current hire price */}
            <div>
                <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
                    <span>you lock (SUI)</span>
                    {suggestedHirePriceMist > 0n && (
                        <button
                            type="button"
                            onClick={() => setAmountSui(suggested)}
                            className="text-amber-bright hover:text-amber-bright/80"
                        >
                            use hire price · {suggested}
                        </button>
                    )}
                </div>
                <input
                    type="number"
                    step="0.001"
                    min="0.000001"
                    value={amountSui}
                    onChange={(e) => setAmountSui(e.target.value)}
                    className="w-full border border-border bg-base px-3 py-2.5 font-mono text-base text-amber-bright focus:border-amber/70 focus:outline-none"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="deadline (hours)">
                    <input
                        type="number"
                        min="1"
                        value={deadlineHours}
                        onChange={(e) => setDeadlineHours(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
                <Field label="dispute window (hours)">
                    <input
                        type="number"
                        min="0"
                        max="720"
                        value={disputeHours}
                        onChange={(e) => setDisputeHours(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
            </div>

            <Field label="spec url (optional)">
                <input
                    type="text"
                    placeholder="https://… or ipfs://…"
                    value={specUrl}
                    onChange={(e) => setSpecUrl(e.target.value)}
                    className="w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                />
            </Field>

            <button
                type="submit"
                disabled={submitting || isPending}
                className="w-full border border-amber/70 bg-amber/15 py-2.5 text-[12px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {submitting || isPending ? "signing…" : "lock escrow & hire"}
            </button>
            <p className="text-center text-[10px] uppercase tracking-[0.18em] text-phosphor-faint">
                escrowed · settles via service-payment on release · refundable after deadline
            </p>

            {result?.ok && result.digest && (
                <div className="border border-green-dim/60 bg-green/5 p-3 text-[12px] text-green-bright">
                    work order created ·{" "}
                    <a
                        className="underline hover:text-green-bright/80"
                        href={suiscan("tx", result.digest)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {result.digest.slice(0, 10)}…
                    </a>{" "}
                    — dashboard refreshes in a few seconds.
                </div>
            )}
            {result && !result.ok && (
                <div className="border border-red/60 bg-red/5 p-3 text-[12px] text-red-bright">
                    {result.error}
                </div>
            )}
        </form>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
                {label}
            </span>
            <span className="mt-1 block">{children}</span>
        </label>
    );
}

function short(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
        return JSON.stringify(err);
    } catch {
        return "unknown error";
    }
}

function parseSuiToMist(s: string): bigint {
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new Error("amount is empty");
    // Reject scientific notation, signs, and multi-dot inputs — they're
    // ambiguous against the simple decimal-pair parser below.
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`invalid amount "${s}" — must be a positive decimal like 0.1`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "000000000").slice(0, 9);
    const wholeBig = BigInt(whole);
    const fracBig = BigInt(fracPadded || "0");
    return wholeBig * 1_000_000_000n + fracBig;
}
