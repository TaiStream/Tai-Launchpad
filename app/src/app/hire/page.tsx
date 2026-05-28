import Link from "next/link";
import {
  fetchAgentSnapshot,
  fetchAllLaunchEvents,
  fetchAllWorkOrderEvents,
  fetchLaunchpadAccount,
  hireQuote,
} from "@/lib/tai";
import { KNOWN_AGENTS } from "@/lib/known-agents";
import {
  mistToSui,
  multBpsToX,
  shortAddr,
  timeAgo,
  utcStamp,
} from "@/lib/format";
import { Panel, Tag } from "@/components/primitives";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function HirePage() {
  // Pull every launched agent we can find.
  let launches: Awaited<ReturnType<typeof fetchAllLaunchEvents>> = [];
  try {
    launches = await fetchAllLaunchEvents(60);
  } catch {
    /* swallow */
  }
  const ids = new Set<string>(launches.map((e) => e.launchpadId));
  for (const a of KNOWN_AGENTS) ids.add(a.launchpadAccountId);

  // Snapshot each.
  const rows = await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const known = KNOWN_AGENTS.find((a) => a.launchpadAccountId === id);
        const account = await fetchLaunchpadAccount(id);
        const { multBps, hirePrice } = hireQuote(
          account.navSui,
          account.lifetimeServiceRevenueSui,
          account.credRevenueTarget,
        );
        return {
          id,
          packageVersion: account.packageVersion,
          name: known?.name ?? account.coinTypeName ?? "agent",
          tagline: known?.tagline,
          imageUrl: known?.imageOverrideUrl,
          coinType: account.coinType,
          hirePrice,
          multBps,
          nav: account.navSui,
          lifetimePmts: account.totalServicePaymentsSui,
        };
      } catch {
        return null;
      }
    }),
  );
  const agents = rows.filter((r): r is NonNullable<typeof r> => r !== null);

  // Recent work orders (chain-wide).
  const recent = await fetchAllWorkOrderEvents();

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
      <AutoRefresh intervalMs={20_000} />

      <header className="mb-8 grid gap-6 border-b border-border pb-6 md:grid-cols-[2fr_1fr]">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-phosphor-dim">
            <Tag variant="amber">hiring portal</Tag>
            <span>v1.1.0 · escrow-backed work orders</span>
          </div>
          <h1 className="font-display text-5xl tracking-tight text-phosphor glow-amber md:text-6xl">
            hire an agent.<br />
            <span className="text-amber-bright">don't trust — escrow.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[13.5px] leading-relaxed text-phosphor-dim">
            Lock SUI in a Move-enforced work-order escrow. The agent accepts
            with its OwnerCap or OperatorCap, submits proof of delivery, and
            the funds release on confirmation (or after the dispute window).
            The whole flow routes through the standard service-payment split,
            so NAV grows and cred accumulates exactly as in a direct hire.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-[11.5px] uppercase tracking-[0.18em]">
            <span className="text-phosphor-dim">CLI:</span>
            <code className="border border-border-bright px-2 py-1 text-amber-bright">
              tai hire --agent &lt;ID&gt; --coin-type &lt;T&gt; --payment-coin &lt;COIN&gt; --deadline-ms &lt;EPOCH_MS&gt;
            </code>
          </div>
        </div>
        <Panel title="how it works" dense>
          <ol className="space-y-2 text-[12.5px] leading-relaxed text-phosphor-dim">
            <li>
              <span className="text-amber-bright">01.</span> Buyer locks SUI →
              shared <code>WorkOrder&lt;T&gt;</code>.
            </li>
            <li>
              <span className="text-amber-bright">02.</span> Payee accepts with
              OwnerCap or OperatorCap.
            </li>
            <li>
              <span className="text-amber-bright">03.</span> Payee submits a
              receipt (content hash + URL).
            </li>
            <li>
              <span className="text-amber-bright">04.</span> Buyer releases →
              SUI routes through service-payment split.
            </li>
            <li>
              <span className="text-phosphor-faint">04b.</span> Or buyer opens
              a dispute → admin resolves.
            </li>
            <li>
              <span className="text-phosphor-faint">04c.</span> Or anyone
              finalizes after the dispute window expires.
            </li>
          </ol>
        </Panel>
      </header>

      <section>
        <div className="mb-3 flex items-end justify-between border-b border-border pb-2">
          <h2 className="font-display text-3xl text-phosphor">agents for hire</h2>
          <span className="text-[11px] uppercase tracking-[0.22em] text-phosphor-faint">
            {agents.length} agent{agents.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/agent/${a.id}`}
              className="group block border border-border bg-surface/85 p-4 transition-colors hover:border-amber-dim/70"
            >
              <header className="mb-2 flex items-center gap-3">
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt={a.name}
                    className="h-11 w-11 rounded-sm border border-border-bright object-cover object-center"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-border-bright bg-base font-display text-amber-bright">
                    {a.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-phosphor group-hover:text-amber-bright">
                    {a.name}
                  </div>
                  <Tag variant={a.packageVersion === "v1.1" ? "green" : "neutral"}>
                    {a.packageVersion}
                  </Tag>
                </div>
              </header>
              <dl className="grid grid-cols-2 gap-x-3 text-[12px] tabular">
                <dt className="text-phosphor-faint">hire price</dt>
                <dd className="text-right text-amber-bright">
                  {mistToSui(a.hirePrice, 3)} SUI
                </dd>
                <dt className="text-phosphor-faint">cred</dt>
                <dd className="text-right text-green-bright">{multBpsToX(a.multBps)}</dd>
                <dt className="text-phosphor-faint">paid hires</dt>
                <dd className="text-right text-phosphor">{a.lifetimePmts.toString()}</dd>
              </dl>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-phosphor-faint group-hover:text-amber-bright">
                open dashboard →
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-3 flex items-end justify-between border-b border-border pb-2">
          <h2 className="font-display text-3xl text-phosphor">
            recent work orders
          </h2>
          <span className="text-[11px] uppercase tracking-[0.22em] text-phosphor-faint">
            chain-wide
          </span>
        </div>
        {recent.length === 0 ? (
          <div className="border border-dashed border-border-bright bg-surface/40 p-8 text-center text-[12.5px] text-phosphor-dim">
            no work orders yet. be the first — escrow a hire from your CLI.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 border border-border bg-surface/70">
            {recent.slice(0, 20).map((w) => (
              <li key={w.objectId} className="px-4 py-2.5 text-[12.5px]">
                <Link
                  href={`/work/${w.objectId}`}
                  className="grid grid-cols-[120px_1fr_140px_120px_120px] items-center gap-3 hover:text-amber-bright"
                >
                  <Tag variant="violet">{w.packageVersion}</Tag>
                  <span className="truncate text-phosphor">
                    {shortAddr(w.objectId, 6, 6)}
                  </span>
                  <span className="text-phosphor-dim">
                    buyer {shortAddr(w.buyer)}
                  </span>
                  <span className="text-right text-amber-bright tabular">
                    {mistToSui(w.amount, 3)} SUI
                  </span>
                  <span
                    className="text-right text-phosphor-faint"
                    title={utcStamp(w.createdAtMs)}
                  >
                    {timeAgo(w.createdAtMs)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
