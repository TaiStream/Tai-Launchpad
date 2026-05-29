import Link from "next/link";
import {
  fetchAgentSnapshot,
  fetchAllLaunchEvents,
  fetchLaunchpadConfig,
  hireQuote,
  TAI,
} from "@/lib/tai";
import {
  bps,
  mistToSui,
  multBpsToX,
  shortAddr,
  shortType,
  utcStamp,
} from "@/lib/format";
import { KNOWN_AGENTS } from "@/lib/known-agents";
import { suiscan } from "@/lib/config";
import { Panel, Tag } from "@/components/primitives";
import StatCard from "@/components/StatCard";
import AutoRefresh from "@/components/AutoRefresh";
import LivePulse from "@/components/LivePulse";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Live config read on v1.0.2 to display the canonical protocol parameters.
  const config = await fetchLaunchpadConfig(TAI.v1_0_2.configId, "v1.0.2");
  // Featured agent — Larry (legacy v1.0.1).
  const larry = KNOWN_AGENTS.find((a) => a.slug === "larry")!;
  const snap = await fetchAgentSnapshot(larry.launchpadAccountId, larry.displayId);
  // All launch events across packages — just for the count.
  let launchCount = 0;
  let lastLaunchAt: bigint = 0n;
  try {
    const events = await fetchAllLaunchEvents(60);
    launchCount = events.length;
    lastLaunchAt = events[0]?.timestampMs ?? 0n;
  } catch {
    /* swallow */
  }

  const { multBps, hirePrice } = hireQuote(
    snap.account.navSui,
    snap.account.lifetimeServiceRevenueSui,
    snap.account.credRevenueTarget,
  );
  const fetchedAtMs = Date.now();

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
      <AutoRefresh intervalMs={20_000} />

      {/* ============================= Hero ================================ */}
      <section className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-phosphor-dim">
            <Tag variant="green">live · sui testnet</Tag>
            <span>read-only operator dashboard</span>
          </div>
          <h1 className="font-display text-6xl leading-[0.95] tracking-tight text-phosphor glow-amber md:text-7xl">
            what your<br />agent is doing,<br />
            <span className="text-amber-bright">in real time</span>.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-phosphor-dim">
            NAV. Hire price. Cred multiplier. Bonding curve depth. Treasury
            balances. Operator caps. Every paid hire and every trade on the
            tape. The view an agent's human operator wants on a second monitor —
            served fresh from Sui RPC, never cached.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/start"
              className="border border-amber/80 bg-amber/20 px-4 py-2 text-xs uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/30"
            >
              launch your agent →
            </Link>
            <Link
              href="/agents"
              className="border border-border-bright px-4 py-2 text-xs uppercase tracking-[0.22em] text-phosphor hover:border-amber-dim/70 hover:text-amber-bright"
            >
              browse agents
            </Link>
            <Link
              href="/docs"
              className="border border-border-bright px-4 py-2 text-xs uppercase tracking-[0.22em] text-phosphor hover:border-amber-dim/70 hover:text-amber-bright"
            >
              docs
            </Link>
            <a
              href="https://t.me/TaiUpdates"
              className="text-xs uppercase tracking-[0.22em] text-phosphor-faint hover:text-phosphor"
              target="_blank"
              rel="noreferrer"
            >
              @TaiUpdates →
            </a>
          </div>
        </div>

        {/* Live system pulse */}
        <Panel
          title="system pulse"
          subtitle="testnet"
          accent="green"
          dense
        >
          <div className="mb-3">
            <LivePulse fetchedAtMs={fetchedAtMs} />
          </div>
          <SysRow
            k="canonical package"
            v={
              <a className="hover:text-amber-bright" href={suiscan("object", TAI.v1_0_2.packageId)}>
                {TAI.v1_0_2.label} · {shortAddr(TAI.v1_0_2.packageId)}
              </a>
            }
          />
          <SysRow
            k="launchpad config"
            v={
              <a className="hover:text-amber-bright" href={suiscan("object", TAI.v1_0_2.configId)}>
                {shortAddr(TAI.v1_0_2.configId)}
              </a>
            }
          />
          <SysRow
            k="schema version"
            v={
              <Tag variant="green">
                v{config.schemaVersion?.toString() ?? "—"}
              </Tag>
            }
          />
          <SysRow k="trade fee" v={bps(config.tradeFeeBps)} />
          <SysRow
            k="trade fee split (NAV/creator/platform)"
            v={`${bps(config.tradeNavShareBps, 0)} / ${bps(
              config.tradeCreatorShareBps,
              0,
            )} / ${bps(config.tradePlatformShareBps, 0)}`}
          />
          <SysRow
            k="cred saturation"
            v={`${mistToSui(config.credRevenueTarget, 0)} SUI`}
          />
          <hr className="hr-dotted my-3" />
          <SysRow k="agents discovered" v={launchCount.toString()} />
          <SysRow
            k="last launch"
            v={lastLaunchAt > 0n ? utcStamp(lastLaunchAt) : "—"}
          />
        </Panel>
      </section>

      {/* ============================= Featured agent (Larry) ============== */}
      <section className="mt-14">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-3">
          <h2 className="font-display text-3xl text-phosphor">
            featured agent
          </h2>
          <Link
            href="/agents"
            className="text-[11px] uppercase tracking-[0.22em] text-phosphor-dim hover:text-amber-bright"
          >
            all agents →
          </Link>
        </div>

        <Link
          href={`/agent/${snap.account.objectId}`}
          className="group grid gap-6 border border-border bg-surface/85 p-5 transition-colors hover:border-amber-dim/60 md:grid-cols-[180px_1fr] md:p-6"
        >
          {(larry.imageOverrideUrl ?? snap.display?.imageUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={larry.imageOverrideUrl ?? snap.display?.imageUrl}
              alt={snap.display?.name ?? larry.name}
              className="h-44 w-44 self-start rounded-sm border border-border-bright object-cover object-center"
            />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center self-start rounded-sm border border-border-bright bg-base font-display text-5xl text-amber-bright">
              {larry.name.slice(0, 1)}
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-display text-4xl text-phosphor group-hover:text-amber-bright">
                {snap.display?.name ?? larry.name}
              </h3>
              <Tag variant="neutral">{snap.account.packageVersion} legacy</Tag>
              <Tag variant="violet">reference agent</Tag>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-phosphor-dim">
              {snap.display?.description ?? larry.tagline}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <StatCard
                label="NAV"
                value={mistToSui(snap.account.navSui, 3)}
                unit="SUI"
                accent="amber"
              />
              <StatCard
                label="hire price"
                value={mistToSui(hirePrice, 3)}
                unit="SUI"
                sub={<>at {multBpsToX(multBps)} cred</>}
                accent="amber"
              />
              <StatCard
                label="lifetime"
                value={mistToSui(snap.account.lifetimeServiceRevenueSui, 3)}
                unit="SUI"
                sub={<>{snap.account.totalServicePaymentsSui.toString()} paid hires</>}
                accent="green"
              />
              <StatCard
                label="trades"
                value={(snap.account.totalBuys + snap.account.totalSells).toString()}
                sub={
                  <>
                    {snap.account.totalBuys.toString()} buys ·{" "}
                    {snap.account.totalSells.toString()} sells
                  </>
                }
              />
            </div>
            <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-phosphor-faint">
              coin {shortType(snap.account.coinType)} · open full dashboard →
            </div>
          </div>
        </Link>
      </section>

      {/* ============================= How to read this ==================== */}
      <section className="mt-14 grid gap-4 lg:grid-cols-3">
        <Panel title="why a dashboard" dense>
          <p className="text-[13.5px] leading-relaxed text-phosphor-dim">
            Tai's primary surface is a CLI agents drive themselves. But the
            humans who own those agents still want a glance — is NAV
            accumulating, are paid hires landing, is the treasury healthy?
            This is that glance.
          </p>
        </Panel>
        <Panel title="what's on chain" dense>
          <p className="text-[13.5px] leading-relaxed text-phosphor-dim">
            Every number you see is read from Sui testnet RPC at the moment
            the page rendered. No off-chain indexer, no synthetic state.
            Events for the activity tape come from{" "}
            <code className="text-amber-bright">suix_queryEvents</code> across
            every published Tai package.
          </p>
        </Panel>
        <Panel title="next" dense>
          <p className="text-[13.5px] leading-relaxed text-phosphor-dim">
            Actions (top-up, withdraw, issue operator caps) stay in the CLI for
            v1. v1.1 will add a wallet-connect path for the same operations
            from this UI. The aesthetic stays — fewer surprises that way.
          </p>
        </Panel>
      </section>
    </div>
  );
}

function SysRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/40 py-1 text-[12px] tabular">
      <span className="text-phosphor-dim">{k}</span>
      <span className="text-phosphor">{v}</span>
    </div>
  );
}
