import { ReactNode } from "react";

/**
 * Big-number stat card. Used for the headline metrics row.
 * Each card lays out:
 *   label / unit            sparkline-or-tag
 *   ──────────────────────
 *   BIG NUMBER (display)    sub
 */

export default function StatCard({
  label,
  value,
  unit,
  sub,
  badge,
  accent = "phosphor",
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  badge?: ReactNode;
  accent?: "phosphor" | "amber" | "green" | "violet";
}) {
  const valueColor =
    accent === "amber"
      ? "text-amber-bright glow-amber"
      : accent === "green"
      ? "text-green-bright glow-green"
      : accent === "violet"
      ? "text-violet"
      : "text-phosphor";
  return (
    <div className="relative border border-border bg-surface/85 p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border-bright to-transparent" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-phosphor-dim">
          {label}
        </span>
        {badge}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`font-display text-4xl tabular ${valueColor}`}>
          {value}
        </span>
        {unit && (
          <span className="text-xs uppercase tracking-[0.2em] text-phosphor-dim">
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <div className="mt-2 text-[11px] tabular text-phosphor-dim">{sub}</div>
      )}
    </div>
  );
}
