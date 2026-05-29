import Link from "next/link";
import { LaunchpadAccountView, hireQuote } from "@/lib/tai";
import { mistToSui, multBpsToX, shortAddr } from "@/lib/format";
import { Tag } from "./primitives";

/**
 * Compact card used in the /agents listing. Pulls the headline numbers off
 * the account snapshot and links to the full dashboard. Display data (image,
 * name) is optional and falls back to a static name + a colored sigil.
 */

export default function AgentCard({
  account,
  name,
  imageUrl,
  tagline,
}: {
  account: LaunchpadAccountView;
  name: string;
  imageUrl?: string;
  tagline?: string;
}) {
  const { multBps, hirePrice } = hireQuote(
    account.navSui,
    account.lifetimeServiceRevenueSui,
    account.credRevenueTarget,
  );
  return (
    <Link
      href={`/agent/${account.objectId}`}
      className="group flex flex-col gap-3 border border-border bg-surface/80 p-4 transition-colors hover:border-amber-dim/70 hover:bg-surface-2/80"
    >
      <header className="flex items-center gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="h-12 w-12 rounded-sm border border-border-bright object-cover object-center"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-border-bright bg-base font-display text-amber-bright">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-base font-medium text-phosphor group-hover:text-amber-bright">
              {name}
            </h3>
            <Tag variant={account.packageVersion === "v1.1" ? "green" : "neutral"}>
              {account.packageVersion}
            </Tag>
            {account.packageVersion === "v1.1" && (
              <Tag variant="red">testnet · early</Tag>
            )}
          </div>
          {tagline && (
            <p className="truncate text-[11.5px] text-phosphor-dim">{tagline}</p>
          )}
        </div>
      </header>
      <hr className="hr-dotted" />
      <dl className="grid grid-cols-3 gap-3 text-[12px] tabular">
        <Mini k="NAV" v={mistToSui(account.navSui, 3)} unit="SUI" />
        <Mini
          k="Hire"
          v={mistToSui(hirePrice, 3)}
          unit="SUI"
          accent="amber"
        />
        <Mini
          k="Cred"
          v={multBpsToX(multBps, 2)}
          accent="green"
          sub="service only"
        />
      </dl>
      <footer className="flex items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-phosphor-faint">
        <span>id {shortAddr(account.objectId)}</span>
        <span className="text-phosphor-dim group-hover:text-amber-bright">
          open dashboard →
        </span>
      </footer>
    </Link>
  );
}

function Mini({
  k,
  v,
  unit,
  accent,
  sub,
}: {
  k: string;
  v: string;
  unit?: string;
  accent?: "amber" | "green";
  sub?: string;
}) {
  const color =
    accent === "amber"
      ? "text-amber-bright"
      : accent === "green"
      ? "text-green-bright"
      : "text-phosphor";
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
        {k}
      </dt>
      <dd className={`mt-0.5 ${color}`}>
        {v}
        {unit && (
          <span className="ml-1 text-[10px] text-phosphor-dim">{unit}</span>
        )}
      </dd>
      {sub && (
        <div className="text-[9px] uppercase tracking-[0.15em] text-phosphor-faint">
          {sub}
        </div>
      )}
    </div>
  );
}
