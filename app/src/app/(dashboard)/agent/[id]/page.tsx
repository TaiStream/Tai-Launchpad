import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchAgentSnapshot,
  fetchWorkOrdersForAgent,
  hireQuote,
  WORK_ORDER_STATUS,
  workOrderStatusLabel,
} from "@/lib/tai";
import { findKnown, TESTNET_EARLY_USER_IMAGE_URL } from "@/lib/known-agents";
import { suiscan } from "@/lib/config";
import {
  bps,
  mistToSui,
  multBpsToX,
  shortAddr,
  shortType,
  unitsToCoin,
  utcStamp,
} from "@/lib/format";
import StatCard from "@/components/StatCard";
import { KV, Panel, Tag } from "@/components/primitives";
import LivePulse from "@/components/LivePulse";
import AutoRefresh from "@/components/AutoRefresh";
import ActivityFeed from "@/components/ActivityFeed";
import HireForm from "@/components/HireForm";
import TradeForm from "@/components/TradeForm";

export const dynamic = "force-dynamic";

type RouteParams = { id: string };

export default async function AgentPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id } = await params;

  // Allow slug shortcuts ("larry") or full object IDs.
  const known = findKnown(id);
  const launchpadAccountId = known?.launchpadAccountId ?? id;
  if (!launchpadAccountId.startsWith("0x")) notFound();

  let snap;
  try {
    snap = await fetchAgentSnapshot(launchpadAccountId, known?.displayId);
  } catch {
    notFound();
  }

  // Best-effort: fetch work orders targeting this agent. Failures are silent.
  let workOrders: Awaited<ReturnType<typeof fetchWorkOrdersForAgent>> = [];
  try {
    workOrders = await fetchWorkOrdersForAgent(launchpadAccountId);
  } catch {
    /* swallow */
  }

  const { account, treasury, config, display, events, fetchedAtMs } = snap;
  const { multBps, hirePrice } = hireQuote(
    account.navSui,
    account.lifetimeServiceRevenueSui,
    account.credRevenueTarget,
  );

  // Coin symbol from the type — last token after ::
  const symbol =
    account.coinType.split("::").pop() ?? account.coinTypeName ?? "T";
  const displayName = display?.name ?? known?.name ?? `Agent ${symbol}`;
  const displayDesc = display?.description ?? known?.tagline;
  // Curated override wins (e.g. Larry's blue mascot; Demo's red fish).
  // Otherwise prefer the on-chain Display.image_url. Otherwise fall back to
  // the testnet-early-user cohort art for v1.1.0+ agents (the red fish).
  const isTestnetCurrent = account.packageVersion === "v1.1";
  const avatarUrl =
    known?.imageOverrideUrl ??
    display?.imageUrl ??
    (isTestnetCurrent ? TESTNET_EARLY_USER_IMAGE_URL : undefined);

  // Bonding-curve spot price (SUI per token, in MIST per base unit).
  const spotMistPerToken =
    account.realToken === 0n
      ? 0n
      : ((account.realSui + account.virtualSui) * 10n ** BigInt(account.decimals)) /
        (account.realToken + account.virtualToken);

  const launchedAtStamp = utcStamp(account.launchedAt);

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
      <AutoRefresh intervalMs={15_000} />

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-phosphor-faint">
        <Link href="/" className="hover:text-phosphor">home</Link>
        <span>·</span>
        <Link href="/agents" className="hover:text-phosphor">agents</Link>
        <span>·</span>
        <span className="text-phosphor">{shortAddr(account.objectId, 6, 6)}</span>
      </nav>

      {/* ============================= Header card ========================= */}
      <header className="grid gap-6 border border-border bg-surface/80 p-5 md:grid-cols-[160px_1fr_auto] md:p-7">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-32 w-32 self-start rounded-sm border border-border-bright object-cover object-center md:h-40 md:w-40"
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center self-start rounded-sm border border-border-bright bg-base font-display text-5xl text-amber-bright md:h-40 md:w-40">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-4xl tracking-tight text-phosphor glow-amber md:text-5xl">
              {displayName}
            </h1>
            <Tag variant={account.packageVersion === "v1.1" ? "green" : "neutral"}>
              {account.packageVersion}
            </Tag>
          </div>
          {displayDesc && (
            <p className="mt-2 max-w-2xl text-[13.5px] text-phosphor-dim">
              {displayDesc}
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] tabular text-phosphor-dim md:max-w-2xl md:grid-cols-3">
            <Field
              label="coin"
              value={
                <a
                  href={suiscan("object", account.coinType.split("::")[0])}
                  className="hover:text-amber-bright"
                  title={account.coinType}
                >
                  {shortType(account.coinType)}
                </a>
              }
            />
            <Field
              label="launchpad id"
              value={
                <a
                  href={suiscan("object", account.objectId)}
                  className="hover:text-amber-bright"
                >
                  {shortAddr(account.objectId, 6, 6)}
                </a>
              }
            />
            <Field
              label="creator"
              value={
                <a
                  href={suiscan("address", account.creator)}
                  className="hover:text-amber-bright"
                >
                  {shortAddr(account.creator, 6, 6)}
                </a>
              }
            />
            <Field
              label="treasury"
              value={
                <a
                  href={suiscan("object", account.agentTreasuryId)}
                  className="hover:text-amber-bright"
                >
                  {shortAddr(account.agentTreasuryId, 6, 6)}
                </a>
              }
            />
            <Field
              label="owner cap"
              value={
                <a
                  href={suiscan("object", account.ownerCapId)}
                  className="hover:text-amber-bright"
                >
                  {shortAddr(account.ownerCapId, 6, 6)}
                </a>
              }
            />
            <Field
              label="launched"
              value={
                <span title={launchedAtStamp}>
                  {launchedAtStamp.slice(0, 10)}
                </span>
              }
            />
          </dl>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <LivePulse fetchedAtMs={fetchedAtMs} />
          {(() => {
            // Larry's runtime is well-known; otherwise prefer the Display.link
            // value the creator registered, and only show the button when one
            // of those is actually present.
            const isLarry = known?.slug === "larry";
            const runtimeUrl = isLarry
              ? "https://larry-the-analyst.guanyidu98.workers.dev"
              : display?.link;
            if (!runtimeUrl) return null;
            return (
              <a
                href={runtimeUrl}
                target="_blank"
                rel="noreferrer"
                className="border border-amber-dim/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/10"
              >
                agent runtime →
              </a>
            );
          })()}
        </div>
      </header>

      {/* ============================= Headline stats ====================== */}
      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <StatCard
          label="NAV (sui)"
          value={mistToSui(account.navSui, 3)}
          unit="SUI"
          sub={
            <>
              productive treasury · grows from trade fees + completed hires ·
              non-withdrawable. (the agent's spendable working-capital treasury
              is a separate balance — see below)
            </>
          }
          accent="amber"
        />
        <StatCard
          label="hire price"
          value={mistToSui(hirePrice, 3)}
          unit="SUI"
          sub={
            <>
              NAV × <span className="text-amber-bright">{multBpsToX(multBps)}</span>{" "}
              cred · saturates at 2.00x
            </>
          }
          accent="amber"
        />
        <StatCard
          label="cred multiplier"
          value={multBpsToX(multBps)}
          sub={
            <>
              from {mistToSui(account.lifetimeServiceRevenueSui, 3)} SUI lifetime
              · target {mistToSui(account.credRevenueTarget, 0)} SUI
            </>
          }
          accent="green"
        />
        <StatCard
          label="lifetime revenue"
          value={mistToSui(account.lifetimeServiceRevenueSui, 3)}
          unit="SUI"
          sub={
            <>
              {account.totalServicePaymentsSui.toString()} SUI pmts ·{" "}
              {account.totalServicePaymentsToken.toString()} token pmts
            </>
          }
          accent="green"
        />
      </section>

      {/* ============================= Actions (trade · hire) ============== */}
      <section className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="trade the curve"
          subtitle="bonding curve · 1% fee"
          accent="green"
        >
          <TradeForm
            launchpadAccountId={account.objectId}
            coinType={account.coinType}
            packageVersion={account.packageVersion}
            decimals={account.decimals}
            symbol={symbol}
            realSui={account.realSui}
            realToken={account.realToken}
            virtualSui={account.virtualSui}
            virtualToken={account.virtualToken}
            tradeFeeBps={config.tradeFeeBps}
          />
        </Panel>
        <Panel
          title="hire this agent"
          subtitle="escrow · settles via service-payment"
          accent="amber"
        >
          <HireForm
            launchpadAccountId={account.objectId}
            coinType={account.coinType}
            suggestedHirePriceMist={hirePrice}
          />
        </Panel>
      </section>

      {/* ============================= Mid grid: curve · treasury ========== */}
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="bonding curve" subtitle={`${symbol} / SUI · market liquidity`} accent="amber">
          <KV
            k="real SUI in pool"
            v={`${mistToSui(account.realSui, 4)} SUI`}
            accent="amber"
          />
          <KV
            k={`real ${symbol} in pool`}
            v={unitsToCoin(account.realToken, account.decimals, 2)}
          />
          <KV
            k="virtual SUI reserves"
            v={`${mistToSui(account.virtualSui, 0)} SUI`}
          />
          <KV
            k={`virtual ${symbol} reserves`}
            v={unitsToCoin(account.virtualToken, account.decimals, 0)}
          />
          <KV
            k="spot price (1 token ≈)"
            v={`${mistToSui(spotMistPerToken, 9)} SUI`}
            accent="amber"
          />
          <KV
            k="LP reserve (locked)"
            v={unitsToCoin(account.lpReserve, account.decimals, 0)}
          />
          <hr className="hr-dotted my-3" />
          <div className="grid grid-cols-2 gap-y-1 text-[12px] tabular text-phosphor-dim">
            <span>buys</span>
            <span className="text-right text-phosphor">
              {account.totalBuys.toString()}
            </span>
            <span>sells</span>
            <span className="text-right text-phosphor">
              {account.totalSells.toString()}
            </span>
            <span>cumulative volume</span>
            <span className="text-right text-phosphor">
              {mistToSui(account.cumulativeVolumeSui, 3)} SUI
            </span>
            <span>cumulative fees</span>
            <span className="text-right text-phosphor">
              {mistToSui(account.cumulativeFeesSui, 4)} SUI
            </span>
          </div>
        </Panel>

        <Panel
          title="agent treasury"
          subtitle="spendable working capital · owner-gated"
          accent="green"
        >
          <p className="mb-3 border border-border bg-base/40 px-3 py-2 text-[11.5px] leading-relaxed text-phosphor-dim">
            Separate from NAV. Funded by top-ups and transfer-to-object
            claims — <span className="text-phosphor">not</span> by trades or
            hires (those grow the pool + NAV). This is what the agent spends
            from. Top it up with{" "}
            <code className="text-amber-bright">
              tai-core / sui call agent_treasury::top_up_sui
            </code>
            .
          </p>
          <KV
            k="SUI balance"
            v={`${mistToSui(treasury.suiBalance, 4)} SUI`}
            accent="green"
          />
          <KV
            k={`${symbol} balance`}
            v={unitsToCoin(treasury.tokenBalance, account.decimals, 2)}
          />
          <KV
            k="active operator caps"
            v={treasury.activeOperatorCapIds.length.toString()}
          />
          <KV
            k="treasury id"
            v={
              <a
                className="hover:text-amber-bright"
                href={suiscan("object", treasury.objectId)}
              >
                {shortAddr(treasury.objectId, 6, 6)}
              </a>
            }
            mono
          />
          <KV
            k="owner cap id"
            v={
              <a
                className="hover:text-amber-bright"
                href={suiscan("object", treasury.ownerCapId)}
              >
                {shortAddr(treasury.ownerCapId, 6, 6)}
              </a>
            }
            mono
          />
          {treasury.activeOperatorCapIds.length > 0 && (
            <>
              <hr className="hr-dotted my-3" />
              <div className="text-[11px] uppercase tracking-[0.18em] text-phosphor-faint">
                operator caps
              </div>
              <ul className="mt-2 space-y-1">
                {treasury.activeOperatorCapIds.map((capId) => (
                  <li
                    key={capId}
                    className="flex items-center justify-between text-[12px] tabular"
                  >
                    <a
                      className="text-phosphor-dim hover:text-amber-bright"
                      href={suiscan("object", capId)}
                    >
                      {shortAddr(capId, 6, 6)}
                    </a>
                    <Tag variant="violet">active</Tag>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </section>

      {/* ============================= Config + activity =================== */}
      <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Panel title="protocol config" subtitle={config.packageVersion}>
          <KV k="trade fee" v={bps(config.tradeFeeBps)} />
          <KV
            k="trade split (NAV/cre/plat)"
            v={`${bps(config.tradeNavShareBps, 0)} / ${bps(
              config.tradeCreatorShareBps,
              0,
            )} / ${bps(config.tradePlatformShareBps, 0)}`}
          />
          <KV
            k="service-SUI split"
            v={`${bps(config.serviceNavShareBps, 0)} / ${bps(
              config.serviceCreatorShareBps,
              0,
            )} / ${bps(config.servicePlatformShareBps, 0)}`}
          />
          <KV
            k="service-token split"
            v={`${bps(config.tokenServiceNavShareBps, 0)} / ${bps(
              config.tokenServiceCreatorShareBps,
              0,
            )} / ${bps(config.tokenServiceBurnShareBps, 0)} burn`}
          />
          <KV
            k="cred saturation target"
            v={`${mistToSui(config.credRevenueTarget, 0)} SUI`}
          />
          <KV
            k="accept token payments"
            v={
              <Tag variant={account.acceptCoinPayments ? "green" : "neutral"}>
                {account.acceptCoinPayments ? "yes" : "no"}
              </Tag>
            }
          />
          <KV
            k="access threshold"
            v={
              account.accessThreshold === 0n
                ? "—"
                : unitsToCoin(account.accessThreshold, account.decimals, 0)
            }
          />
          <KV
            k="linked identity"
            v={
              account.linkedIdentity
                ? shortAddr(account.linkedIdentity, 6, 6)
                : "—"
            }
            mono
          />
          {account.schemaVersion !== null && (
            <KV
              k="schema version"
              v={account.schemaVersion.toString()}
              accent="green"
            />
          )}
        </Panel>

        <Panel
          title="activity tape"
          subtitle="trades + service payments · newest first"
          accent="violet"
        >
          <ActivityFeed
            events={events}
            decimals={account.decimals}
            symbol={symbol}
          />
        </Panel>
      </section>

      {/* ============================= Work orders ========================== */}
      <section className="mt-6">
        <Panel
          title="work orders"
          subtitle={
            workOrders.length === 0
              ? "no escrow hires yet"
              : `${workOrders.length} order${workOrders.length === 1 ? "" : "s"}`
          }
          accent="amber"
        >
          {workOrders.length === 0 ? (
            <div className="border border-dashed border-border-bright bg-surface/40 p-6 text-center text-[12.5px] text-phosphor-dim">
              No work-order escrows targeting this agent. Be the first — hire it
              with the card above.{" "}
              <Link href="/docs/hiring" className="text-amber-bright hover:text-amber-bright/80">
                how escrow works →
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden border border-border bg-surface/50">
              <div className="grid grid-cols-[140px_1fr_120px_120px_120px] gap-3 border-b border-border bg-surface-2/70 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-phosphor-faint">
                <span>status</span>
                <span>order</span>
                <span className="text-right">amount</span>
                <span className="text-right">buyer</span>
                <span className="text-right">created</span>
              </div>
              <ol className="divide-y divide-border/60">
                {workOrders.map((w) => {
                  const tone =
                    w.status === WORK_ORDER_STATUS.RELEASED
                      ? "green"
                      : w.status === WORK_ORDER_STATUS.DISPUTED
                      ? "red"
                      : w.status === WORK_ORDER_STATUS.REFUNDED
                      ? "neutral"
                      : "amber";
                  return (
                    <li
                      key={w.objectId}
                      className="grid grid-cols-[140px_1fr_120px_120px_120px] items-center gap-3 px-3 py-2 text-[12.5px] tabular hover:bg-surface-2/40"
                    >
                      <Tag variant={tone}>{workOrderStatusLabel(w.status)}</Tag>
                      <Link
                        href={`/work/${w.objectId}`}
                        className="truncate text-phosphor hover:text-amber-bright"
                      >
                        {shortAddr(w.objectId, 6, 6)}
                      </Link>
                      <span className="text-right text-amber-bright">
                        {mistToSui(w.amount, 3)} SUI
                      </span>
                      <span className="truncate text-right text-phosphor-dim">
                        {shortAddr(w.buyer)}
                      </span>
                      <span
                        className="text-right text-phosphor-faint"
                        title={utcStamp(w.createdAtMs)}
                      >
                        {(() => {
                          const ago = Date.now() - Number(w.createdAtMs);
                          if (ago < 60_000) return `${Math.floor(ago / 1000)}s ago`;
                          if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
                          if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`;
                          return `${Math.floor(ago / 86_400_000)}d ago`;
                        })()}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
        {label}
      </dt>
      <dd className="truncate text-phosphor">{value}</dd>
    </div>
  );
}
