"use client";

import { useEffect, useMemo, useState } from "react";
import {
    useCurrentAccount,
    useSignAndExecuteTransaction,
    useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { TAI, suiscan, type TaiPackageInfo } from "@/lib/config";
import { mistToSui } from "@/lib/format";
import { computeBuy, computeSell } from "@/lib/tai";

/**
 * Buy / sell tabs on the agent dashboard. Builds a one-PTB tx that either:
 *
 *   BUY:  splitCoins(gas, [amount]) → moveCall launchpad::buy<T>(config, account, coin, min_out, clock)
 *   SELL: pickCoinT(amount)         → moveCall launchpad::sell<T>(config, account, coin, min_out, clock)
 *
 * For SELL we read the connected wallet's owned Coin<T> objects, merge them
 * into one virtual balance, and split off the user-requested amount. The
 * Transaction builder handles the actual merge during simulation.
 */

const POLL_BALANCES_MS = 8_000;

function packageFor(version: string): TaiPackageInfo {
    if (version === "v1.1.0") return TAI.v1_1_0;
    if (version === "v1.0.2") return TAI.v1_0_2;
    if (version === "v1.0.1") return TAI.v1_0_1;
    return TAI.v1_1_0;
}

export default function TradeForm({
    launchpadAccountId,
    coinType,
    packageVersion,
    decimals,
    symbol,
    realSui,
    realToken,
    virtualSui,
    virtualToken,
    tradeFeeBps,
}: {
    launchpadAccountId: string;
    coinType: string;
    packageVersion: string;
    decimals: number;
    symbol: string;
    realSui: bigint;
    realToken: bigint;
    virtualSui: bigint;
    virtualToken: bigint;
    tradeFeeBps: bigint;
}) {
    const account = useCurrentAccount();
    const suiClient = useSuiClient();
    const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

    const [side, setSide] = useState<"buy" | "sell">("buy");
    const [amount, setAmount] = useState("0.05");
    const [slippagePct, setSlippagePct] = useState("5");
    const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
    const [suiBalance, setSuiBalance] = useState<bigint | null>(null);
    const [result, setResult] = useState<
        { ok: true; digest: string } | { ok: false; error: string } | null
    >(null);

    // Poll balances of the connected wallet.
    useEffect(() => {
        if (!account) {
            setTokenBalance(null);
            setSuiBalance(null);
            return;
        }
        let cancelled = false;
        const refresh = async () => {
            try {
                const [sui, tok] = await Promise.all([
                    suiClient.getBalance({ owner: account.address }),
                    suiClient.getBalance({
                        owner: account.address,
                        coinType,
                    }),
                ]);
                if (cancelled) return;
                setSuiBalance(BigInt(sui.totalBalance));
                setTokenBalance(BigInt(tok.totalBalance));
            } catch {
                if (cancelled) return;
            }
        };
        refresh();
        const id = setInterval(refresh, POLL_BALANCES_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [account, suiClient, coinType]);

    const pkg = useMemo(() => packageFor(packageVersion), [packageVersion]);

    // Live estimate of trade output. Recomputes as the user types.
    // For `buy`: SUI in → estimated tokens out.
    // For `sell`: tokens in → estimated SUI out.
    const estimate = useMemo(() => {
        try {
            if (side === "buy") {
                const mist = parseSuiToMist(amount);
                if (mist <= 0n) return null;
                const { tokensOut, fee } = computeBuy(
                    realSui, realToken, virtualSui, virtualToken,
                    mist, tradeFeeBps,
                );
                return { kind: "buy" as const, tokensOut, fee, suiIn: mist };
            } else {
                const tok = parseUnits(amount, decimals);
                if (tok <= 0n) return null;
                const { suiOut, fee } = computeSell(
                    realSui, realToken, virtualSui, virtualToken,
                    tok, tradeFeeBps,
                );
                return { kind: "sell" as const, suiOut, fee, tokensIn: tok };
            }
        } catch {
            return null;
        }
    }, [side, amount, decimals, realSui, realToken, virtualSui, virtualToken, tradeFeeBps]);

    // Slippage-protected minimum-out: estimate * (10_000 - slippageBps) / 10_000.
    const slippageBps = useMemo(() => {
        const pct = Math.min(100, Math.max(0, Number(slippagePct) || 0));
        return BigInt(Math.floor(pct * 100));
    }, [slippagePct]);

    const minOut = useMemo(() => {
        if (!estimate) return 0n;
        const exact = estimate.kind === "buy" ? estimate.tokensOut : estimate.suiOut;
        return (exact * (10_000n - slippageBps)) / 10_000n;
    }, [estimate, slippageBps]);

    if (!account) {
        return (
            <div className="border border-dashed border-border-bright bg-surface/40 p-5 text-[12.5px] text-phosphor-dim">
                Connect a wallet to trade. The CLI alternative is{" "}
                <code className="text-amber-bright">
                    tai buy --launchpad {short(launchpadAccountId)} --coin-type "{shortType(coinType)}" --payment-coin &lt;ID&gt;
                </code>
                .
            </div>
        );
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!account) return;
        setResult(null);
        try {
            const slippage = Math.min(100, Math.max(0, Number(slippagePct) || 0));
            const tx = new Transaction();
            tx.setSender(account.address);

            if (side === "buy") {
                const mist = parseSuiToMist(amount);
                if (mist <= 0n) throw new Error("amount must be > 0");
                const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
                tx.moveCall({
                    target: `${pkg.packageId}::launchpad::buy`,
                    typeArguments: [coinType],
                    arguments: [
                        tx.object(pkg.configId),
                        tx.object(launchpadAccountId),
                        coin,
                        tx.pure.u64(minOut), // local curve sim × slippage
                        tx.object("0x6"),
                    ],
                });
            } else {
                const tokenUnits = parseUnits(amount, decimals);
                if (tokenUnits <= 0n) throw new Error("amount must be > 0");
                if (tokenBalance !== null && tokenUnits > tokenBalance) {
                    throw new Error(
                        `not enough ${symbol} in wallet (have ${unitsToString(tokenBalance, decimals, 4)}, need ${unitsToString(tokenUnits, decimals, 4)})`,
                    );
                }
                // Find the wallet's Coin<T> objects, merge into one, split the user amount.
                const owned = await suiClient.getCoins({
                    owner: account.address,
                    coinType,
                });
                if (owned.data.length === 0) {
                    throw new Error(`no ${symbol} coins in connected wallet`);
                }
                const [primary, ...rest] = owned.data;
                const primaryArg = tx.object(primary.coinObjectId);
                if (rest.length > 0) {
                    tx.mergeCoins(
                        primaryArg,
                        rest.map((c) => tx.object(c.coinObjectId)),
                    );
                }
                const [tokens] = tx.splitCoins(primaryArg, [tx.pure.u64(tokenUnits)]);
                tx.moveCall({
                    target: `${pkg.packageId}::launchpad::sell`,
                    typeArguments: [coinType],
                    arguments: [
                        tx.object(pkg.configId),
                        tx.object(launchpadAccountId),
                        tokens,
                        tx.pure.u64(minOut),
                        tx.object("0x6"),
                    ],
                });
            }

            await new Promise<void>((resolve, reject) => {
                signAndExecute(
                    { transaction: tx },
                    {
                        onSuccess: ({ digest }) => {
                            setResult({ ok: true, digest });
                            resolve();
                        },
                        onError: (err) => {
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

    return (
        <form onSubmit={onSubmit} className="space-y-3">
            {/* Tabs */}
            <div className="flex gap-2 text-[11px] uppercase tracking-[0.22em]">
                <button
                    type="button"
                    onClick={() => setSide("buy")}
                    className={`border px-3 py-1.5 ${
                        side === "buy"
                            ? "border-green-dim/70 bg-green/15 text-green-bright"
                            : "border-border text-phosphor-dim hover:text-phosphor"
                    }`}
                >
                    buy
                </button>
                <button
                    type="button"
                    onClick={() => setSide("sell")}
                    className={`border px-3 py-1.5 ${
                        side === "sell"
                            ? "border-amber/70 bg-amber/15 text-amber-bright"
                            : "border-border text-phosphor-dim hover:text-phosphor"
                    }`}
                >
                    sell
                </button>
                <div className="ml-auto self-center text-[10.5px] tracking-[0.18em] text-phosphor-faint">
                    {side === "buy" ? (
                        <>
                            wallet SUI ·{" "}
                            <span className="text-phosphor">
                                {suiBalance !== null ? mistToSui(suiBalance, 4) : "—"}
                            </span>
                        </>
                    ) : (
                        <>
                            wallet {symbol} ·{" "}
                            <span className="text-phosphor">
                                {tokenBalance !== null
                                    ? unitsToString(tokenBalance, decimals, 2)
                                    : "—"}
                            </span>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <Field
                    label={side === "buy" ? "spend (SUI)" : `sell (${symbol})`}
                >
                    <input
                        type="number"
                        step="0.000001"
                        min="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
                <Field label="slippage (% — informational v1)">
                    <input
                        type="number"
                        min="0"
                        max="100"
                        value={slippagePct}
                        onChange={(e) => setSlippagePct(e.target.value)}
                        className="w-full border border-border bg-base px-2 py-1.5 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                </Field>
            </div>
            {/* Live curve estimate — recomputes as you type */}
            {estimate && (
                <div className="border border-border bg-base/60 px-3 py-2 text-[12px] tabular text-phosphor-dim">
                    {estimate.kind === "buy" ? (
                        <>
                            <span className="text-phosphor-faint">est. receive</span>{" "}
                            <span className="text-green-bright">
                                ≈ {unitsToString(estimate.tokensOut, decimals, 2)} {symbol}
                            </span>
                            <span className="text-phosphor-faint"> · fee </span>
                            <span>{mistToSui(estimate.fee, 5)} SUI</span>
                            <span className="text-phosphor-faint"> · min after slippage </span>
                            <span className="text-amber-bright">
                                {unitsToString(minOut, decimals, 2)} {symbol}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="text-phosphor-faint">est. receive</span>{" "}
                            <span className="text-amber-bright">
                                ≈ {mistToSui(estimate.suiOut, 5)} SUI
                            </span>
                            <span className="text-phosphor-faint"> · fee </span>
                            <span>{mistToSui(estimate.fee, 5)} SUI</span>
                            <span className="text-phosphor-faint"> · min after slippage </span>
                            <span className="text-amber-bright">
                                {mistToSui(minOut, 5)} SUI
                            </span>
                        </>
                    )}
                </div>
            )}

            <div className="flex items-center justify-between">
                <span className="text-[10.5px] uppercase tracking-[0.18em] text-phosphor-faint">
                    {side === "buy"
                        ? "1% trade fee · 30/60/10 NAV/creator/platform split"
                        : "1% trade fee on the SUI received · sell pays you, fee taken from gross"}
                </span>
                <button
                    type="submit"
                    disabled={isPending}
                    className={`border px-4 py-1.5 text-[11px] uppercase tracking-[0.22em] disabled:cursor-not-allowed disabled:opacity-50 ${
                        side === "buy"
                            ? "border-green-dim/70 bg-green/15 text-green-bright hover:bg-green/25"
                            : "border-amber/70 bg-amber/15 text-amber-bright hover:bg-amber/25"
                    }`}
                >
                    {isPending ? "signing…" : side === "buy" ? "buy" : "sell"}
                </button>
            </div>

            {result?.ok && (
                <div className="border border-green-dim/60 bg-green/5 p-3 text-[12px] text-green-bright">
                    {side === "buy" ? "buy" : "sell"} confirmed ·{" "}
                    <a
                        className="underline hover:text-green-bright/80"
                        href={suiscan("tx", result.digest)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {result.digest.slice(0, 10)}…
                    </a>{" "}
                    — pool refreshes in a few seconds.
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

function parseSuiToMist(s: string): bigint {
    return parseUnits(s, 9);
}

function parseUnits(s: string, decimals: number): bigint {
    const trimmed = s.trim();
    if (trimmed.length === 0) return 0n;
    // Reject scientific notation, signs, and multi-dot inputs to match the
    // strict numeric form the form labels promise.
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`invalid amount "${s}"`);
    }
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
    const wholeBig = BigInt(whole);
    const fracBig = BigInt(fracPadded || "0");
    return wholeBig * 10n ** BigInt(decimals) + fracBig;
}

function unitsToString(u: bigint, decimals: number, digits: number): string {
    const div = 10n ** BigInt(decimals);
    const whole = u / div;
    const frac = u % div;
    const fracStr = frac
        .toString()
        .padStart(decimals, "0")
        .slice(0, digits);
    return `${whole.toString()}.${fracStr}`;
}

function short(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortType(t: string): string {
    if (!t.includes("::")) return t;
    const [a, ...rest] = t.split("::");
    return `${short(a)}::${rest.join("::")}`;
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
