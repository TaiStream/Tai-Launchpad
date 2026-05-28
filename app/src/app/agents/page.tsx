import {
  fetchAllLaunchEvents,
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
        const isTestnetCurrent = account.packageVersion === "v1.1.0";
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

  return rows
    .filter((r): r is Row => r !== null)
    .sort((a, b) => {
      // v1.0.2 above v1.0.1; within same version, newer launches first.
      const v =
        (a.account.packageVersion === "v1.0.2" ? 0 : 1) -
        (b.account.packageVersion === "v1.0.2" ? 0 : 1);
      if (v !== 0) return v;
      return a.account.launchedAt < b.account.launchedAt ? 1 : -1;
    });
}

export default async function AgentsPage() {
  const rows = await loadRows();

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 md:px-8">
      <AutoRefresh intervalMs={20_000} />
      <header className="mb-8 flex items-end justify-between gap-4 border-b border-border pb-5">
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
        <div className="hidden text-right text-[11px] uppercase tracking-[0.2em] text-phosphor-faint md:block">
          <div>{rows.length} agent{rows.length === 1 ? "" : "s"}</div>
          <div>auto-refresh · 20s</div>
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
    </div>
  );
}
