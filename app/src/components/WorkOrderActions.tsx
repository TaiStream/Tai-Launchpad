"use client";

import { useState } from "react";
import {
    useCurrentAccount,
    useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import {
    TAI,
    type TaiPackageInfo,
} from "@/lib/config";
import {
    WORK_ORDER_STATUS,
    type WorkOrderStatusCode,
    type WorkOrderView,
} from "@/lib/tai";
import { suiscan } from "@/lib/config";

/**
 * Wallet-driven actions for a single WorkOrder<T>. Renders the right button
 * set depending on (status, connected address):
 *
 *   - buyer:   release / refund / dispute (when applicable)
 *   - payee:   accept / submit_receipt    (needs OwnerCap or OperatorCap id)
 *   - anyone:  release (only after dispute window expires)
 */

type Result =
    | { kind: "idle" }
    | { kind: "signing" }
    | { kind: "ok"; digest: string }
    | { kind: "err"; message: string };

function packageFor(version: string): TaiPackageInfo {
    if (version === "v1.1") return TAI.v1_1;
    if (version === "v1.0.2") return TAI.v1_0_2;
    if (version === "v1.0.1") return TAI.v1_0_1;
    // Default to latest; release will only ever land if Move-side accepts it.
    return TAI.v1_1;
}

export default function WorkOrderActions({ order }: { order: WorkOrderView }) {
    const account = useCurrentAccount();
    const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
    const [result, setResult] = useState<Result>({ kind: "idle" });
    const [capId, setCapId] = useState("");
    const [receiptHex, setReceiptHex] = useState("");
    const [receiptUrl, setReceiptUrl] = useState("");

    if (!account) {
        return (
            <div className="border border-dashed border-border-bright bg-surface/40 p-4 text-[12.5px] text-phosphor-dim">
                Connect a Sui wallet to take action on this work order. CLI
                paths are listed under "next actions" below.
            </div>
        );
    }

    const pkg = packageFor(order.packageVersion);
    const isBuyer = sameAddress(account.address, order.buyer);
    const status = order.status;
    const now = Date.now();
    const inDisputeWindow =
        status === WORK_ORDER_STATUS.RECEIPT_SUBMITTED &&
        BigInt(now) < order.receiptSubmittedAtMs + order.disputeWindowMs;
    const windowExpired =
        status === WORK_ORDER_STATUS.RECEIPT_SUBMITTED &&
        BigInt(now) >= order.receiptSubmittedAtMs + order.disputeWindowMs;
    const pastDeadline = BigInt(now) >= order.deadlineMs;

    function build(target: string, args: ((tx: Transaction) => unknown)[]) {
        const tx = new Transaction();
        const built = args.map((arg) => arg(tx));
        tx.moveCall({
            target: `${pkg.packageId}::work_order::${target}`,
            typeArguments: [order.coinType],
            arguments: built as never,
        });
        return tx;
    }

    function run(label: string, tx: Transaction) {
        setResult({ kind: "signing" });
        signAndExecute(
            { transaction: tx },
            {
                onSuccess: ({ digest }) => setResult({ kind: "ok", digest }),
                onError: (err) =>
                    setResult({
                        kind: "err",
                        message: `${label} failed — ${errorMessage(err)}`,
                    }),
            },
        );
    }

    function onAccept(asOperator: boolean) {
        if (!isHex(capId, 32)) {
            setResult({
                kind: "err",
                message: "paste the cap object id (0x-hex, 32 bytes) first",
            });
            return;
        }
        const tx = build(
            asOperator ? "accept_work_order_with_operator_v2" : "accept_work_order_with_owner",
            asOperator
                ? [
                      (tx) => tx.object(order.objectId),
                      (tx) => tx.object(capId),
                      (tx) => tx.object(order.payeeAgentTreasuryId),
                      (tx) => tx.object("0x6"),
                  ]
                : [
                      (tx) => tx.object(order.objectId),
                      (tx) => tx.object(capId),
                      (tx) => tx.object("0x6"),
                  ],
        );
        run("accept", tx);
    }

    function onSubmit(asOperator: boolean) {
        if (!isHex(capId, 32)) {
            setResult({
                kind: "err",
                message: "paste the cap object id first",
            });
            return;
        }
        let bytes: Uint8Array;
        try {
            bytes = parseHex(receiptHex);
        } catch (err) {
            setResult({
                kind: "err",
                message: `receipt hash invalid — ${errorMessage(err)}`,
            });
            return;
        }
        const tx = build(
            asOperator ? "submit_receipt_with_operator_v2" : "submit_receipt_with_owner",
            asOperator
                ? [
                      (tx) => tx.object(order.objectId),
                      (tx) => tx.object(capId),
                      (tx) => tx.object(order.payeeAgentTreasuryId),
                      (tx) => tx.pure.vector("u8", Array.from(bytes)),
                      (tx) => tx.pure.string(receiptUrl),
                      (tx) => tx.object("0x6"),
                  ]
                : [
                      (tx) => tx.object(order.objectId),
                      (tx) => tx.object(capId),
                      (tx) => tx.pure.vector("u8", Array.from(bytes)),
                      (tx) => tx.pure.string(receiptUrl),
                      (tx) => tx.object("0x6"),
                  ],
        );
        run("submit_receipt", tx);
    }

    function onRelease() {
        const tx = build("release_work_order", [
            (tx) => tx.object(order.objectId),
            (tx) => tx.object(pkg.configId),
            (tx) => tx.object(order.payeeLaunchpadAccountId),
            (tx) => tx.object("0x6"),
        ]);
        run("release", tx);
    }

    function onRefund() {
        const tx = build("refund_work_order", [
            (tx) => tx.object(order.objectId),
            (tx) => tx.object("0x6"),
        ]);
        run("refund", tx);
    }

    function onDispute() {
        const tx = build("open_dispute", [
            (tx) => tx.object(order.objectId),
            (tx) => tx.object("0x6"),
        ]);
        run("dispute", tx);
    }

    const showPayeeActions =
        status === WORK_ORDER_STATUS.NEW ||
        status === WORK_ORDER_STATUS.ACCEPTED;
    const showRefund =
        isBuyer &&
        (status === WORK_ORDER_STATUS.NEW ||
            status === WORK_ORDER_STATUS.ACCEPTED) &&
        pastDeadline;
    const showRelease =
        status === WORK_ORDER_STATUS.RECEIPT_SUBMITTED &&
        (isBuyer || windowExpired);
    const showDispute =
        isBuyer && status === WORK_ORDER_STATUS.RECEIPT_SUBMITTED && inDisputeWindow;
    const terminal =
        status === WORK_ORDER_STATUS.RELEASED ||
        status === WORK_ORDER_STATUS.REFUNDED ||
        status === WORK_ORDER_STATUS.DISPUTED;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-[11px] uppercase tracking-[0.18em] text-phosphor-faint sm:grid-cols-4">
                <div>connected · {short(account.address)}</div>
                <div>role · {isBuyer ? <span className="text-amber-bright">buyer</span> : "third party"}</div>
                <div>status · {statusName(status)}</div>
                <div>{pastDeadline ? "past deadline" : "within deadline"}</div>
            </div>

            {/* Payee actions (require a cap id input) */}
            {showPayeeActions && (
                <div className="border border-border bg-surface-2/40 p-3">
                    <div className="mb-2 text-[10.5px] uppercase tracking-[0.2em] text-phosphor-faint">
                        payee actions
                    </div>
                    <input
                        type="text"
                        value={capId}
                        onChange={(e) => setCapId(e.target.value)}
                        placeholder="OwnerCap or OperatorCap object id (0x…)"
                        className="mb-2 block w-full border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-phosphor focus:border-amber/70 focus:outline-none"
                    />
                    {status === WORK_ORDER_STATUS.NEW && (
                        <div className="flex flex-wrap gap-2">
                            <ActionButton onClick={() => onAccept(false)} disabled={isPending}>
                                accept (owner cap)
                            </ActionButton>
                            <ActionButton onClick={() => onAccept(true)} disabled={isPending}>
                                accept (operator cap)
                            </ActionButton>
                        </div>
                    )}
                    {status === WORK_ORDER_STATUS.ACCEPTED && (
                        <>
                            <div className="my-2 grid gap-2 sm:grid-cols-2">
                                <input
                                    type="text"
                                    value={receiptHex}
                                    onChange={(e) => setReceiptHex(e.target.value)}
                                    placeholder="receipt hex (e.g. 0xdeadbeef) — optional"
                                    className="block w-full border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-phosphor focus:border-amber/70 focus:outline-none"
                                />
                                <input
                                    type="text"
                                    value={receiptUrl}
                                    onChange={(e) => setReceiptUrl(e.target.value)}
                                    placeholder="receipt url"
                                    className="block w-full border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-phosphor focus:border-amber/70 focus:outline-none"
                                />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <ActionButton onClick={() => onSubmit(false)} disabled={isPending}>
                                    submit receipt (owner cap)
                                </ActionButton>
                                <ActionButton onClick={() => onSubmit(true)} disabled={isPending}>
                                    submit receipt (operator cap)
                                </ActionButton>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Buyer + open actions */}
            {(showRelease || showRefund || showDispute) && (
                <div className="border border-border bg-surface-2/40 p-3">
                    <div className="mb-2 text-[10.5px] uppercase tracking-[0.2em] text-phosphor-faint">
                        finalize
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {showRelease && (
                            <ActionButton onClick={onRelease} disabled={isPending} variant="green">
                                release (routes through service-payment)
                            </ActionButton>
                        )}
                        {showRefund && (
                            <ActionButton onClick={onRefund} disabled={isPending}>
                                refund (deadline passed)
                            </ActionButton>
                        )}
                        {showDispute && (
                            <ActionButton onClick={onDispute} disabled={isPending} variant="red">
                                open dispute
                            </ActionButton>
                        )}
                    </div>
                </div>
            )}

            {terminal && (
                <div className="border border-dashed border-border-bright bg-surface/40 p-4 text-[12.5px] text-phosphor-dim">
                    Terminal state. No further actions.
                </div>
            )}

            {result.kind === "ok" && (
                <div className="border border-green-dim/60 bg-green/5 p-3 text-[12.5px] text-green-bright">
                    success ·{" "}
                    <a
                        className="underline hover:text-green-bright/80"
                        href={suiscan("tx", result.digest)}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {result.digest.slice(0, 10)}…
                    </a>{" "}
                    — page refreshes in a few seconds.
                </div>
            )}
            {result.kind === "err" && (
                <div className="border border-red/60 bg-red/5 p-3 text-[12.5px] text-red-bright">
                    {result.message}
                </div>
            )}
        </div>
    );
}

function ActionButton({
    onClick,
    disabled,
    children,
    variant = "amber",
}: {
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
    variant?: "amber" | "green" | "red";
}) {
    const cls =
        variant === "green"
            ? "border-green-dim/70 bg-green/10 text-green-bright hover:bg-green/20"
            : variant === "red"
            ? "border-red/60 bg-red/10 text-red-bright hover:bg-red/20"
            : "border-amber/70 bg-amber/10 text-amber-bright hover:bg-amber/20";
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`border px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
        >
            {children}
        </button>
    );
}

function statusName(s: WorkOrderStatusCode): string {
    switch (s) {
        case WORK_ORDER_STATUS.NEW:
            return "new";
        case WORK_ORDER_STATUS.ACCEPTED:
            return "accepted";
        case WORK_ORDER_STATUS.RECEIPT_SUBMITTED:
            return "receipt submitted";
        case WORK_ORDER_STATUS.RELEASED:
            return "released";
        case WORK_ORDER_STATUS.REFUNDED:
            return "refunded";
        case WORK_ORDER_STATUS.DISPUTED:
            return "disputed";
    }
}

function isHex(s: string, byteLen: number): boolean {
    if (!s.startsWith("0x")) return false;
    return s.length === 2 + byteLen * 2 && /^0x[0-9a-fA-F]+$/.test(s);
}

function parseHex(s: string): Uint8Array {
    let h = s.trim();
    if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
    if (h.length === 0) return new Uint8Array(0);
    if (h.length % 2 !== 0) throw new Error("hex must be even-length");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
    }
    return out;
}

function sameAddress(a: string, b: string): boolean {
    return normalize(a) === normalize(b);
}

function normalize(a: string): string {
    let h = a.trim().toLowerCase();
    if (h.startsWith("0x")) h = h.slice(2);
    return "0x" + h.padStart(64, "0");
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
