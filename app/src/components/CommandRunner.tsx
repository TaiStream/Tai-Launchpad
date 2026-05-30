"use client";

import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { TAI, suiscan, type TaiPackageInfo } from "@/lib/config";
import { mistToSui } from "@/lib/format";
import {
  resolvePriceMist,
  serializeEscrowSpec,
  type TaiCommand,
} from "@/lib/commands";

function packageFor(version: string): TaiPackageInfo {
  if (version === "v1.0.2") return TAI.v1_0_2;
  if (version === "v1.0.1") return TAI.v1_0_1;
  return TAI.v1_1;
}

function parseSuiToMist(s: string): bigint {
  const t = s.trim().replace(",", ".");
  if (t.length === 0) throw new Error("amount is empty");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`invalid amount "${s}"`);
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9) || "0");
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "unknown error";
  }
}

export default function CommandRunner({
  command,
  launchpadAccountId,
  coinType,
  packageVersion,
  hirePriceMist,
  fulfillmentUrl,
}: {
  command: TaiCommand;
  launchpadAccountId: string;
  coinType: string;
  packageVersion: string;
  hirePriceMist: bigint;
  fulfillmentUrl?: string;
}) {
  const account = useCurrentAccount();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const pkg = packageFor(packageVersion);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [priceSui, setPriceSui] = useState(
    mistToSui(resolvePriceMist(command.price, hirePriceMist), 4),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "tx"; digest: string }
    | { kind: "answer"; text: string; digest: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  function setInput(key: string, v: string) {
    setInputs((prev) => ({ ...prev, [key]: v }));
  }

  function validate(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of command.inputs) {
      const v = (inputs[f.key] ?? "").trim();
      if (f.required && !v) throw new Error(`${f.label} is required`);
      if (f.maxLen && v.length > f.maxLen)
        throw new Error(`${f.label} is too long (max ${f.maxLen})`);
      if (v) out[f.key] = v;
    }
    return out;
  }

  if (!account) {
    return (
      <p className="text-[12px] text-phosphor-dim">
        Connect a Sui wallet (top-right) to run <strong>{command.label}</strong>.
      </p>
    );
  }

  async function runSync() {
    const filled = validate();
    const amountMist = parseSuiToMist(priceSui);
    if (amountMist <= 0n) throw new Error("price must be > 0");
    if (!fulfillmentUrl) throw new Error("this agent has no fulfillment endpoint");

    // (c) Pre-pay health ping — never pay an offline agent.
    try {
      const ping = await fetch(fulfillmentUrl, { method: "GET" });
      if (!ping.ok) throw new Error();
    } catch {
      throw new Error("agent appears offline — try again later (you were not charged)");
    }

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${pkg.packageId}::launchpad::record_service_payment_sui`,
      typeArguments: [coinType],
      arguments: [
        tx.object(pkg.configId),
        tx.object(launchpadAccountId),
        coin,
        tx.object("0x6"),
      ],
    });

    const digest = await new Promise<string>((resolve, reject) => {
      signAndExecute(
        { transaction: tx },
        {
          onSuccess: ({ digest }) => resolve(digest),
          onError: (e) => reject(e),
        },
      );
    });

    // Relay to the agent for fulfillment.
    try {
      const res = await fetch(fulfillmentUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: command.id,
          inputs: filled,
          paymentTxDigest: digest,
          coinType,
          launchpadAccountId,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; result?: string; error?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? `fulfillment failed (${res.status})`);
      }
      setResult({ kind: "answer", text: body.result ?? "(no content)", digest });
    } catch (e) {
      // Payment already settled — surface the digest so the payer has proof.
      setResult({
        kind: "err",
        message: `paid (tx ${digest.slice(0, 10)}…) but fulfillment failed: ${errMsg(e)}`,
      });
    }
  }

  async function runEscrow() {
    const filled = validate();
    const amountMist = parseSuiToMist(priceSui);
    if (amountMist <= 0n) throw new Error("price must be > 0");
    const { specUrl, specHash } = serializeEscrowSpec(command.id, filled);
    const deadline = BigInt(Date.now()) + 24n * 3_600_000n; // 24h
    const disputeWindow = 3_600_000n; // 1h (>= 5-min floor)

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${TAI.v1_1.packageId}::work_order::create_work_order`,
      typeArguments: [coinType],
      arguments: [
        tx.object(launchpadAccountId),
        coin,
        tx.pure.vector("u8", specHash),
        tx.pure.string(specUrl),
        tx.pure.u64(deadline),
        tx.pure.u64(disputeWindow),
        tx.object("0x6"),
      ],
    });

    const digest = await new Promise<string>((resolve, reject) => {
      signAndExecute(
        { transaction: tx },
        { onSuccess: ({ digest }) => resolve(digest), onError: (e) => reject(e) },
      );
    });
    setResult({ kind: "tx", digest });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setBusy(true);
    try {
      if (command.fulfillment === "sync") await runSync();
      else await runEscrow();
    } catch (err) {
      setResult({ kind: "err", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {command.inputs.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
            {f.label}
          </span>
          {f.type === "textarea" ? (
            <textarea
              value={inputs[f.key] ?? ""}
              placeholder={f.placeholder}
              maxLength={f.maxLen}
              onChange={(e) => setInput(f.key, e.target.value)}
              className="mt-1 w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={inputs[f.key] ?? ""}
              placeholder={f.placeholder}
              maxLength={f.maxLen}
              onChange={(e) => setInput(f.key, e.target.value)}
              className="mt-1 w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
            />
          )}
        </label>
      ))}

      <label className="block">
        <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
          price (SUI){command.price.mode === "fixed" ? " · set by agent" : ""}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={priceSui}
          readOnly={command.price.mode === "fixed"}
          onChange={(e) => setPriceSui(e.target.value)}
          className="mt-1 w-full border border-border bg-base px-3 py-2 font-mono text-[1rem] text-amber-bright focus:border-amber/70 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="w-full border border-amber/70 bg-amber/15 py-2.5 text-[12px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled
          ? "working…"
          : command.fulfillment === "sync"
            ? "pay & run"
            : "lock escrow & commission"}
      </button>
      <p className="text-center text-[10px] uppercase tracking-[0.18em] text-phosphor-faint">
        {command.fulfillment === "sync"
          ? "instant · paid up front · no escrow"
          : "escrow · released on delivery · refundable after deadline"}
      </p>

      {result?.kind === "answer" && (
        <div className="border border-green-dim/60 bg-green/5 p-3 text-[12.5px] text-phosphor">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-green-bright">
            result ·{" "}
            <a className="underline" href={suiscan("tx", result.digest)} target="_blank" rel="noreferrer">
              {result.digest.slice(0, 10)}…
            </a>
          </div>
          <div className="whitespace-pre-wrap">{result.text}</div>
        </div>
      )}
      {result?.kind === "tx" && (
        <div className="border border-green-dim/60 bg-green/5 p-3 text-[12px] text-green-bright">
          work order created ·{" "}
          <a className="underline" href={suiscan("tx", result.digest)} target="_blank" rel="noreferrer">
            {result.digest.slice(0, 10)}…
          </a>{" "}
          — see the work-order page to track delivery.
        </div>
      )}
      {result?.kind === "err" && (
        <div className="border border-red/60 bg-red/5 p-3 text-[12px] text-red-bright">
          {result.message}
        </div>
      )}
    </form>
  );
}
