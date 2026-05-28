"use client";

import { useEffect, useState } from "react";

/**
 * Animated "live" indicator showing the age of the last server-rendered
 * snapshot. Re-renders every second purely for the elapsed-time string.
 * Background poll is handled at the page level via a soft refresh button
 * (router.refresh) — we don't try to be too clever here.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function elapsed(ms: number) {
  if (ms < 10 * SECOND) return "just now";
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s ago`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  return `${Math.floor(ms / HOUR)}h ago`;
}

export default function LivePulse({
  fetchedAtMs,
  staleAfterMs = 30_000,
}: {
  fetchedAtMs: number;
  staleAfterMs?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const age = now - fetchedAtMs;
  const stale = age > staleAfterMs;
  return (
    <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.18em] text-phosphor-dim">
      <span className={stale ? "dot-stale" : "dot-live"} />
      <span className="uppercase">{stale ? "stale" : "live"}</span>
      <span>· refreshed {elapsed(age)}</span>
    </span>
  );
}
