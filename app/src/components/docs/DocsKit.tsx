import Link from "next/link";
import { ReactNode } from "react";

/**
 * Shared building blocks for the /docs section. Kept in one file so every
 * doc page composes from the same vocabulary and the terminal aesthetic
 * stays consistent.
 */

export function DocTitle({
  kicker,
  title,
  lead,
}: {
  kicker?: string;
  title: string;
  lead?: ReactNode;
}) {
  return (
    <header className="mb-8 border-b border-border pb-6">
      {kicker && (
        <div className="mb-2 text-[11px] uppercase tracking-[0.25em] text-amber-dim">
          {kicker}
        </div>
      )}
      <h1 className="font-display text-4xl leading-tight tracking-tight text-phosphor glow-amber md:text-5xl">
        {title}
      </h1>
      {lead && (
        <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-phosphor-dim">
          {lead}
        </p>
      )}
    </header>
  );
}

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-10 mb-3 scroll-mt-24 border-l-2 border-amber-dim pl-3 font-display text-2xl text-phosphor"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 mb-2 text-base font-semibold uppercase tracking-[0.15em] text-amber-bright">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="my-3 text-[14px] leading-relaxed text-phosphor-dim">
      {children}
    </p>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="my-3 space-y-1.5 text-[14px] leading-relaxed text-phosphor-dim">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="select-none text-amber-dim">·</span>
      <span>{children}</span>
    </li>
  );
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border bg-base/60 px-1 py-0.5 text-[12.5px] text-amber-bright">
      {children}
    </code>
  );
}

/** Block code with optional caption. */
export function Code({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="my-4">
      <pre className="overflow-x-auto border border-border-bright bg-base px-4 py-3 text-[12.5px] leading-relaxed text-amber-bright">
        {children}
      </pre>
      {caption && (
        <div className="mt-1 text-[11px] text-phosphor-faint">{caption}</div>
      )}
    </div>
  );
}

/** A callout box — note / warn / tip. */
export function Note({
  kind = "note",
  children,
}: {
  kind?: "note" | "warn" | "tip";
  children: ReactNode;
}) {
  const styles = {
    note: "border-cyan/40 bg-cyan/5 text-phosphor-dim",
    warn: "border-red/50 bg-red/5 text-red-bright",
    tip: "border-green-dim/60 bg-green/5 text-green-bright",
  } as const;
  const label = { note: "note", warn: "heads up", tip: "tip" }[kind];
  return (
    <div className={`my-4 border ${styles[kind]} px-4 py-3 text-[13px] leading-relaxed`}>
      <span className="mr-2 text-[10px] uppercase tracking-[0.2em] opacity-70">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A 2-col definition row used for stat/parameter lists. */
export function DefRow({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="w-full shrink-0 text-[12.5px] font-medium text-phosphor sm:w-56">
        {k}
      </div>
      <div className="text-[13px] text-phosphor-dim">{v}</div>
    </div>
  );
}

/** Bottom-of-page prev/next navigation. */
export function DocFooterNav({
  prev,
  next,
}: {
  prev?: { href: string; label: string };
  next?: { href: string; label: string };
}) {
  return (
    <nav className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6">
      {prev ? (
        <Link
          href={prev.href}
          className="group text-[12.5px] text-phosphor-dim hover:text-amber-bright"
        >
          <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
            ← prev
          </span>
          {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group text-right text-[12.5px] text-phosphor-dim hover:text-amber-bright"
        >
          <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
            next →
          </span>
          {next.label}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
