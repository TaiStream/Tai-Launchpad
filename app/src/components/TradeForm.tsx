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
}: {
    launchpadAccountId: string;
    coinType: string;
    packageVersion: string;
    decimals: number;
    symbol: string;
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
                // We could simulate the call to compute exact minTokensOut.
                // For v1 we just take an N% slippage on a rough estimate of 0
                // (no simulation) — passing 0 effectively disables slippage.
                // Slippage UI is reserved for a follow-up that simulates first.
                const minOut = slippage === 0 ? 0n : 0n;
                tx.moveCall({
                    target: `${pkg.packageId}::launchpad::buy`,
                    typeArguments: [coinType],
                    arguments: [
                        tx.object(pkg.configId),
                        tx.object(launchpadAccountId),
                        coin,
                        tx.pure.u64(minOut),
                        tx.object("0x6"),
                    ],
                });
            } else {
                const tokenUnits = parseUnits(amount, decimals);
                if (tokenUnits <= 0n) throw new Error("amount must be > 0");
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
                const minOut = 0n; // simulate-then-set is a v1.2 feature
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
    if (!trimmed) return 0n;
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
    const wholeBig = BigInt(whole || "0");
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
