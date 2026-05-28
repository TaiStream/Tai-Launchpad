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
                target: `${TAI.v1_1_0.packageId}::work_order::create_work_order`,
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

    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
                <Field label="amount (SUI)">
                    <input
                        type="number"
                        step="0.001"
                        min="0.000001"
                        value={amountSui}
                        onChange={(e) => setAmountSui(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-amber-bright focus:border-amber/70 focus:outline-none"
                    />
                </Field>
                <Field label="deadline (h)">
                    <input
                        type="number"
                        min="1"
                        value={deadlineHours}
                        onChange={(e) => setDeadlineHours(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
                <Field label="dispute window (h)">
                    <input
                        type="number"
                        min="0"
                        max="720"
                        value={disputeHours}
                        onChange={(e) => setDisputeHours(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
            </div>
            <Field label="spec url (optional)">
                <input
                    type="text"
                    placeholder="https://… or ipfs://…"
                    value={specUrl}
                    onChange={(e) => setSpecUrl(e.target.value)}
                    className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                />
            </Field>
            <div className="flex items-center justify-between">
                <span className="text-[10.5px] uppercase tracking-[0.18em] text-phosphor-faint">
                    paying as {short(account.address)} · escrowed → routes through service-payment on release
                </span>
                <button
                    type="submit"
                    disabled={submitting || isPending}
                    className="border border-amber/70 bg-amber/15 px-4 py-1.5 text-[11px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {submitting || isPending ? "signing…" : "hire (escrow)"}
                </button>
            </div>

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
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) throw new Error("invalid amount");
    // 1 SUI = 1e9 MIST. Use string math to avoid float drift.
    const [whole, frac = ""] = s.trim().split(".");
    const fracPadded = (frac + "000000000").slice(0, 9);
    const wholeBig = BigInt(whole || "0");
    const fracBig = BigInt(fracPadded || "0");
    return wholeBig * 1_000_000_000n + fracBig;
}
