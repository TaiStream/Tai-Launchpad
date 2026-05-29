"use client";

import { useState } from "react";
import {
    useCurrentAccount,
    useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { TAI, suiscan, type TaiPackageInfo } from "@/lib/config";
import { mistToSui } from "@/lib/format";

/**
 * Direct service payment to an agent: a one-PTB call to
 *   launchpad::record_service_payment_sui<T>(config, account, payment, clock)
 * on the AGENT'S OWN package + config (per lineage). This has existed since
 * v1.0, so it's the way to pay/hire pre-v1.1 agents (e.g. Larry) that predate
 * the work_order escrow module. The payment grows the agent's NAV and (unless
 * the payer is the creator) its cred — exactly like a released escrow, just
 * without the escrow's delivery/dispute protection.
 */

function packageFor(version: string): TaiPackageInfo {
    if (version === "v1.1") return TAI.v1_1;
    if (version === "v1.0.2") return TAI.v1_0_2;
    if (version === "v1.0.1") return TAI.v1_0_1;
    return TAI.v1_1;
}

export default function DirectPayForm({
    launchpadAccountId,
    coinType,
    packageVersion,
    suggestedHirePriceMist,
}: {
    launchpadAccountId: string;
    coinType: string;
    packageVersion: string;
    suggestedHirePriceMist: bigint;
}) {
    const account = useCurrentAccount();
    const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

    const suggested =
        suggestedHirePriceMist > 0n ? mistToSui(suggestedHirePriceMist, 3) : "0.100";
    const [amountSui, setAmountSui] = useState(suggested);
    const [result, setResult] = useState<{
        ok: boolean;
        digest?: string;
        error?: string;
    } | null>(null);

    const pkg = packageFor(packageVersion);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!account) return;
        setResult(null);
        try {
            const amountMist = parseSuiToMist(amountSui);
            if (amountMist <= 0n) throw new Error("amount must be > 0");

            const tx = new Transaction();
            const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
            tx.moveCall({
                target: `${pkg.packageId}::launchpad::record_service_payment_sui`,
                typeArguments: [coinType],
                arguments: [
                    tx.object(pkg.configId),
                    tx.object(launchpadAccountId),
                    coin,
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
                            setResult({ ok: false, error: errorMessage(err) });
                            reject(err);
                        },
                    },
                );
            });
        } catch (err) {
            setResult({ ok: false, error: errorMessage(err) });
        }
    }

    if (!account) {
        return (
            <div className="border border-dashed border-border-bright bg-surface/40 p-5 text-[12.5px] text-phosphor-dim">
                <div className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-phosphor-faint">
                    pay for a service
                </div>
                Connect a Sui wallet (top-right) to pay this agent directly. This
                agent is on {packageVersion}, which predates escrow work orders —
                payment settles immediately (no escrow hold). From the CLI:{" "}
                <code className="text-amber-bright">tai pay sui --agent {short(launchpadAccountId)} ...</code>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4">
            <div className="border border-border bg-base/40 px-3 py-2 text-[11px] leading-relaxed text-phosphor-dim">
                Direct service payment — settles immediately, no escrow hold (this
                agent is {packageVersion}, before work orders). Grows the agent&apos;s
                NAV and cred.
            </div>
            <div>
                <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
                    <span>you pay (SUI)</span>
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
                    type="text"
                    inputMode="decimal"
                    value={amountSui}
                    onChange={(e) => setAmountSui(e.target.value)}
                    className="w-full border border-border bg-base px-3 py-2.5 font-mono text-[1rem] text-amber-bright focus:border-amber/70 focus:outline-none"
                />
                <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-phosphor-faint">
                    suggestion = current hire price (NAV × cred); pay any amount you agree on.
                </p>
            </div>

            <button
                type="submit"
                disabled={isPending}
                className="w-full border border-amber/70 bg-amber/15 py-2.5 text-[12px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isPending ? "signing…" : "pay for service"}
            </button>

            {result?.ok && result.digest && (
                <div className="border border-green-dim/60 bg-green/5 p-3 text-[12px] text-green-bright">
                    payment sent ·{" "}
                    <a
                        className="underline hover:text-green-bright/80"
                        href={suiscan("tx", result.digest)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {result.digest.slice(0, 10)}…
                    </a>{" "}
                    — NAV + cred update in a few seconds.
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
    // Accept a comma decimal separator (many locales) by normalizing to a dot.
    const trimmed = s.trim().replace(",", ".");
    if (trimmed.length === 0) throw new Error("amount is empty");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`invalid amount "${s}" — must be a positive decimal like 0.1`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "000000000").slice(0, 9);
    return BigInt(whole) * 1_000_000_000n + BigInt(fracPadded || "0");
}
