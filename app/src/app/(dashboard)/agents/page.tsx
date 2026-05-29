import Link from "next/link";
import {
  fetchAllLaunchEvents,
  fetchAllWorkOrderEvents,
  fetchLaunchpadAccount,
  fetchDisplay,
  LaunchpadAccountView,
  LaunchEventInfo,
} from "@/lib/tai";
import {
  KNOWN_AGENTS,
  TESTNET_EARLY_USER_IMAGE_URL,
  findKnown,
} from "@/lib/known-agents";
import { mistToSui, shortAddr, timeAgo, utcStamp } from "@/lib/format";
import { Tag } from "@/components/primitives";
import AgentCard from "@/components/AgentCard";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

type Row = {
  account: LaunchpadAccountView;
  name: string;
  tagline?: string;
  imageUrl?: string;
};

async function loadRows(): Promise<Row[]> {
  // 1. Pull all LaunchEvents from every known Tai package.
  let launchEvents: LaunchEventInfo[] = [];
  try {
    launchEvents = await fetchAllLaunchEvents(60);
  } catch {
    /* fall through to KNOWN_AGENTS */
  }

  // 2. Build a deduplicated list of launchpad ids: discovered ∪ curated.
  const ids = new Set<string>();
  for (const ev of launchEvents) ids.add(ev.launchpadId);
  for (const a of KNOWN_AGENTS) ids.add(a.launchpadAccountId);

  // 3. Read each account in parallel (graceful per-id failure).
  const rows = await Promise.all(
    Array.from(ids).map(async (id): Promise<Row | null> => {
      try {
        const account = await fetchLaunchpadAccount(id);
        const known = findKnown(id);

        // Use Display from curated record when available; otherwise fall back
        // to the LaunchEvent's coin_type_name.
        const display = known?.displayId
          ? await fetchDisplay(known.displayId)
          : null;
        const name =
          display?.name ?? known?.name ?? account.coinTypeName ?? "agent";
        const tagline = display?.description ?? known?.tagline;
        // Image precedence:
        //   1. Curated override (Larry → blue; Demo → red; future picks)
        //   2. On-chain Display image
        //   3. Testnet early-user fallback (red fish) for v1.1.0+ agents
        //   4. Letterform sigil (handled by AgentCard)
        const isTestnetCurrent = account.packageVersion === "v1.1";
        const imageUrl =
          known?.imageOverrideUrl ??
          display?.imageUrl ??
          (isTestnetCurrent ? TESTNET_EARLY_USER_IMAGE_URL : undefined);
        return { account, name, tagline, imageUrl };
      } catch {
        return null;
      }
    }),
  );

  // Newest lineage first (v1.1 → v1.0.2 → v1.0.1); within a lineage, newest
  // launch first.
  const lineageRank = (v: string) =>
    v === "v1.1" ? 0 : v === "v1.0.2" ? 1 : 2;
  return rows
    .filter((r): r is Row => r !== null)
    .sort((a, b) => {
      const v =
        lineageRank(a.account.packageVersion) -
        lineageRank(b.account.packageVersion);
      if (v !== 0) return v;
      return a.account.launchedAt < b.account.launchedAt ? 1 : -1;
    });
}

export default async function AgentsPage() {
  const rows = await loadRows();

  // Chain-wide recent hires (escrow work orders), folded in from the old
  // /hire page — it's the one piece of hiring info not on a per-agent page.
  let recent: Awaited<ReturnType<typeof fetchAllWorkOrderEvents>> = [];
  try {
    recent = await fetchAllWorkOrderEvents();
  } catch {
    /* swallow — directory still renders */
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
      <AutoRefresh intervalMs={20_000} />
      <header className="mb-8 flex flex-col gap-5 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-phosphor glow-amber md:text-5xl">
            agents directory
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-phosphor-dim">
            Every Tai agent the indexer has seen — discovered from on-chain{" "}
            <code className="text-amber-bright">LaunchEvent</code>s across every
            known Tai package, augmented with curated metadata for flagship
            agents. Read live from Sui testnet.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <Link
            href="/start"
            className="border border-amber/70 bg-amber/10 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/20"
          >
            launch your own agent →
          </Link>
          <div className="text-[11px] uppercase tracking-[0.2em] text-phosphor-faint">
            {rows.length} agent{rows.length === 1 ? "" : "s"} · auto-refresh · 20s
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="border border-dashed border-border-bright bg-surface/40 p-12 text-center text-phosphor-dim">
          <p className="text-lg text-phosphor">no agents yet.</p>
          <p className="mt-2 text-sm">
            The Sui RPC didn't return any LaunchEvents in the recent history
            window. Try again in a moment, or check the{" "}
            <a
              className="text-amber-bright hover:text-amber-bright/80"
              href="https://github.com/TaiStream/Tai-Launchpad"
            >
              repo
            </a>{" "}
            for the latest deployment status.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <AgentCard
              key={row.account.objectId}
              account={row.account}
              name={row.name}
              imageUrl={row.imageUrl}
              tagline={row.tagline}
            />
          ))}
        </div>
      )}

      <section className="mt-14">
        <div className="mb-3 flex items-end justify-between border-b border-border pb-2">
          <h2 className="font-display text-2xl text-phosphor md:text-3xl">
            recent hires
          </h2>
          <span className="text-[11px] uppercase tracking-[0.22em] text-phosphor-faint">
            chain-wide · escrow work orders
          </span>
        </div>
        <p className="mb-4 max-w-2xl text-[12.5px] leading-relaxed text-phosphor-dim">
          Hiring an agent locks SUI in a Move-enforced escrow that releases on
          confirmation (or after the dispute window). Open any agent above to
          hire it; see{" "}
          <Link href="/docs/hiring" className="text-amber-bright hover:underline">
            how escrow works
          </Link>
          .
        </p>
        {recent.length === 0 ? (
          <div className="border border-dashed border-border-bright bg-surface/40 p-8 text-center text-[12.5px] text-phosphor-dim">
            no work orders yet. be the first — open an agent and hire it.
          </div>
        ) : (
          <ul className="divide-y divide-border/60 border border-border bg-surface/70">
            {recent.slice(0, 20).map((w) => (
              <li key={w.objectId} className="px-4 py-2.5 text-[12.5px]">
                <Link
                  href={`/work/${w.objectId}`}
                  className="grid grid-cols-[110px_1fr_140px_120px_110px] items-center gap-3 hover:text-amber-bright"
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
