import { ReactNode } from "react";

export function Panel({
  children,
  title,
  subtitle,
  accent,
  dense,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  accent?: "amber" | "green" | "violet" | "cyan";
  dense?: boolean;
}) {
  const ring =
    accent === "amber"
      ? "border-amber-dim/60"
      : accent === "green"
      ? "border-green-dim/60"
      : accent === "violet"
      ? "border-violet/40"
      : accent === "cyan"
      ? "border-cyan/40"
      : "border-border";
  return (
    <section
      className={`relative border ${ring} bg-surface/85 backdrop-blur-[1px] ${
        dense ? "p-4" : "p-5 md:p-6"
      }`}
    >
      {(title || subtitle) && (
        <header className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-2.5">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-phosphor">
              {title}
            </h2>
          )}
          {subtitle && (
            <span className="text-[10.5px] tracking-[0.18em] text-phosphor-faint">
              {subtitle}
            </span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function KV({
  k,
  v,
  mono,
  accent,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
  accent?: "amber" | "green" | "red" | "phosphor";
}) {
  const color =
    accent === "amber"
      ? "text-amber-bright"
      : accent === "green"
      ? "text-green-bright"
      : accent === "red"
      ? "text-red-bright"
      : "text-phosphor";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-[12.5px]">
      <span className="text-phosphor-dim">{k}</span>
      <span className={`${mono ? "font-mono" : ""} tabular ${color}`}>{v}</span>
    </div>
  );
}

export function Tag({
  children,
  variant = "neutral",
  title,
}: {
  children: ReactNode;
  variant?: "neutral" | "amber" | "green" | "red" | "violet";
  title?: string;
}) {
  const map = {
    neutral: "border-border text-phosphor-dim",
    amber: "border-amber-dim/70 text-amber-bright bg-amber/5",
    green: "border-green-dim/70 text-green-bright bg-green/5",
    red: "border-red/60 text-red-bright bg-red/5",
    violet: "border-violet/50 text-violet bg-violet/5",
  } as const;
  return (
    <span
      title={title}
      className={`inline-block border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] ${map[variant]}`}
    >
      {children}
    </span>
  );
}
