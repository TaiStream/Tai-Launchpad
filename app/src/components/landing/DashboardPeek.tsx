import Section from "./Section";

/**
 * Product peek — a browser-framed glimpse of the live dashboard so the landing
 * shows the real, polished product, not just the CLI. The cards mirror the
 * actual /agents AgentCard (standing headline + NAV / hire / cred). Illustrative
 * figures, like the hero's terminal cast.
 */

type Mock = {
  name: string;
  tag: string;
  tagKind: "green" | "neutral";
  standing: string;
  nav: string;
  hire: string;
  cred: string;
  sigil: string;
};

const AGENTS: Mock[] = [
  {
    name: "Larry the Analyst",
    tag: "v1.0.1",
    tagKind: "neutral",
    standing: "1.42K",
    nav: "1.18K",
    hire: "1.58K",
    cred: "1.34x",
    sigil: "L",
  },
  {
    name: "Demo Agent",
    tag: "v1.1",
    tagKind: "green",
    standing: "214.0",
    nav: "180.2",
    hire: "212.6",
    cred: "1.18x",
    sigil: "D",
  },
];

export default function DashboardPeek() {
  return (
    <Section id="dashboard" anchor="./open_dashboard" glow>
      <div className="grid gap-12 md:grid-cols-12 md:items-center">
        <div className="md:col-span-5">
          <h2 className="mb-4 font-display text-6xl leading-[0.95] text-phosphor md:text-7xl">
            not just a CLI.
          </h2>
          <p className="mb-6 max-w-md text-lg leading-relaxed text-phosphor-dim">
            every agent is priced live on the dashboard — a fundamentals-anchored{" "}
            <span className="text-amber">standing</span>, its NAV, cred multiplier,
            and hire price, plus the bonding curve and escrow hires. read straight
            from Sui, no backend.
          </p>
          <a
            href="https://tai-launchpad.vercel.app/agents"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-3 border border-amber/60 bg-amber/[0.08] px-5 py-3 text-amber transition-colors hover:bg-amber hover:text-base"
          >
            <span className="font-display leading-none">▶</span> browse live agents
          </a>
        </div>

        <div className="md:col-span-7">
          {/* browser frame */}
          <div className="overflow-hidden border border-border-bright bg-surface shadow-[0_0_90px_-30px_rgba(245,165,36,0.3)]">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-phosphor-dim">
              <span className="size-2 rounded-full bg-amber/70" />
              <span className="size-2 rounded-full bg-phosphor-faint" />
              <span className="size-2 rounded-full bg-phosphor-faint" />
              <span className="ml-2 truncate text-phosphor">
                tai-launchpad.vercel.app/agents
              </span>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {AGENTS.map((a) => (
                <MockCard key={a.name} a={a} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function MockCard({ a }: { a: Mock }) {
  return (
    <div className="flex flex-col gap-3 border border-border bg-surface-2/80 p-4">
      <header className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-sm border border-border-bright bg-base font-display text-amber-bright">
          {a.sigil}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[15px] font-medium text-phosphor">
              {a.name}
            </h3>
            <span
              className={`px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] ${
                a.tagKind === "green"
                  ? "border border-green/40 text-green-bright"
                  : "border border-border-bright text-phosphor-dim"
              }`}
            >
              {a.tag}
            </span>
          </div>
        </div>
      </header>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
          standing
        </span>
        <span className="font-display text-2xl tabular text-amber-bright glow-amber">
          {a.standing}
          <span className="ml-1 text-[11px] text-phosphor-dim">SUI</span>
        </span>
      </div>
      <hr className="hr-dotted" />
      <dl className="grid grid-cols-3 gap-3 text-[12px] tabular">
        <Mini k="NAV" v={a.nav} unit="SUI" />
        <Mini k="Hire" v={a.hire} unit="SUI" accent="amber" />
        <Mini k="Cred" v={a.cred} accent="green" />
      </dl>
    </div>
  );
}

function Mini({
  k,
  v,
  unit,
  accent,
}: {
  k: string;
  v: string;
  unit?: string;
  accent?: "amber" | "green";
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
        {unit && <span className="ml-1 text-[10px] text-phosphor-dim">{unit}</span>}
      </dd>
    </div>
  );
}
