"use client";

import { useEffect, useState } from "react";
import { AgentEvent } from "@/lib/tai";
import { mistToSui, shortAddr, timeAgo } from "@/lib/format";
import { suiscan } from "@/lib/config";
import { Tag } from "./primitives";

/**
 * Scrolling activity log. Server passes in the events array (already sorted
 * newest-first). Client redraws every second for the "ago" timestamps and
 * does not re-fetch (page-level AutoRefresh handles that).
 */

export default function ActivityFeed({
  events,
  decimals,
  symbol,
}: {
  events: AgentEvent[];
  decimals: number;
  symbol: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (events.length === 0) {
    return (
      <div className="border border-dashed border-border-bright bg-surface/40 p-6 text-center text-xs text-phosphor-dim">
        no activity yet. trades and service payments will appear here as they
        land on chain.
      </div>
    );
  }

  return (
    <div className="overflow-hidden border border-border bg-surface/50">
      {/* Column header */}
      <div className="grid grid-cols-[80px_88px_1fr_1fr_120px_84px] gap-3 border-b border-border bg-surface-2/70 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-phosphor-faint">
        <span>kind</span>
        <span>side</span>
        <span>amount</span>
        <span>actor</span>
        <span className="text-right">tx</span>
        <span className="text-right">when</span>
      </div>
      <ol className="divide-y divide-border/60">
        {events.map((ev, i) => (
          <li
            key={`${ev.txDigest}:${i}`}
            className="grid grid-cols-[80px_88px_1fr_1fr_120px_84px] items-center gap-3 px-3 py-2 text-[12.5px] tabular hover:bg-surface-2/40"
          >
            {ev.kind === "trade" ? (
              <TradeRow
                ev={ev}
                decimals={decimals}
                symbol={symbol}
              />
            ) : (
              <ServiceRow ev={ev} decimals={decimals} symbol={symbol} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TradeRow({
  ev,
  decimals,
  symbol,
}: {
  ev: Extract<AgentEvent, { kind: "trade" }>;
  decimals: number;
  symbol: string;
}) {
  const side = ev.isBuy ? "BUY" : "SELL";
  const tone = ev.isBuy ? "green" : "amber";
  const sui = ev.isBuy ? ev.suiIn : ev.suiOut;
  const tok = ev.isBuy ? ev.tokensOut : ev.tokensIn;
  return (
    <>
      <Tag variant="violet">trade</Tag>
      <Tag variant={tone}>{side}</Tag>
      <span className="truncate">
        <span className={`mr-1 ${ev.isBuy ? "text-green-bright" : "text-amber-bright"}`}>
          {mistToSui(sui, 4)}
        </span>
        <span className="text-phosphor-dim">SUI ⇄ </span>
        <span>{formatUnits(tok, decimals)}</span>
        <span className="ml-1 text-phosphor-dim">{symbol}</span>
        <span className="ml-2 text-[10.5px] text-phosphor-faint">
          fee {mistToSui(ev.feeSui, 5)} SUI
        </span>
      </span>
      <a
        href={suiscan("address", ev.trader)}
        className="truncate text-phosphor-dim hover:text-amber-bright"
        title={ev.trader}
      >
        {shortAddr(ev.trader)}
      </a>
      <a
        href={suiscan("tx", ev.txDigest)}
        className="truncate text-right text-phosphor-faint hover:text-amber-bright"
        title={ev.txDigest}
      >
        {ev.txDigest.slice(0, 8)}…
      </a>
      <span className="text-right text-phosphor-dim">
        {timeAgo(ev.timestampMs)}
      </span>
    </>
  );
}

function ServiceRow({
  ev,
  decimals,
  symbol,
}: {
  ev: Extract<AgentEvent, { kind: "service" }>;
  decimals: number;
  symbol: string;
}) {
  const isToken = ev.tokenAmount > 0n;
  return (
    <>
      <Tag variant="amber">service</Tag>
      <Tag variant={ev.countedTowardCred ? "green" : "neutral"}>
        {ev.countedTowardCred ? "CRED" : "SELF"}
      </Tag>
      <span className="truncate">
        {isToken ? (
          <>
            <span className="mr-1 text-amber-bright">
              {formatUnits(ev.tokenAmount, decimals)}
            </span>
            <span className="text-phosphor-dim">{symbol}</span>
          </>
        ) : (
          <>
            <span className="mr-1 text-amber-bright">
              {mistToSui(ev.suiAmount, 4)}
            </span>
            <span className="text-phosphor-dim">SUI</span>
          </>
        )}
        <span className="ml-2 text-[10.5px] text-phosphor-faint">
          lifetime {mistToSui(ev.newLifetimeRevenueSui, 4)} SUI
        </span>
      </span>
      <a
        href={suiscan("address", ev.payer)}
        className="truncate text-phosphor-dim hover:text-amber-bright"
        title={ev.payer}
      >
        {shortAddr(ev.payer)}
      </a>
      <a
        href={suiscan("tx", ev.txDigest)}
        className="truncate text-right text-phosphor-faint hover:text-amber-bright"
        title={ev.txDigest}
      >
        {ev.txDigest.slice(0, 8)}…
      </a>
      <span className="text-right text-phosphor-dim">
        {timeAgo(ev.timestampMs)}
      </span>
    </>
  );
}

function formatUnits(units: bigint, decimals: number): string {
  // Lightweight version of unitsToCoin without grouping for compact rows.
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const frac = units % divisor;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}
