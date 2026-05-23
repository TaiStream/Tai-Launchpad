import Section from "./Section";

const MOVE_MODULES = [
  { name: "bonding_curve", desc: "pure u128 math" },
  { name: "fees", desc: "3 splits · distribute" },
  { name: "agent_treasury", desc: "OwnerCap · OperatorCap · spend" },
  { name: "views", desc: "hire_quote · effective_hire_price" },
];

const STATS = [
  { v: "5", t: "move modules", n: "launchpad · curve · fees · treasury · views" },
  { v: "u128", t: "overflow-safe", n: "every multiplication asserts before downcast" },
  { v: "0", t: "external deps", n: "only the sui framework in v1 core" },
  { v: "v1.1", t: "ika slot reserved", n: "dwallets_object_id: Option<ID>" },
];

export default function Architecture() {
  return (
    <Section id="architecture" anchor="./architecture" label="05">
      <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-4">
        the stack.
      </h2>
      <p className="text-phosphor-dim text-lg max-w-2xl mb-14 leading-relaxed">
        five move modules. one rust crate. one cli. one wasm-backed sdk. no
        SAI dep in v1 core; no Ika dep either — the linkage field is reserved
        so v1.1 cross-chain custody slots in without breaking the v1 object
        layout.
      </p>

      <div className="space-y-0">
        {/* ──────────── LAYER 1: Sui mainnet ──────────── */}
        <Layer
          tag="layer 01"
          title="sui mainnet"
          accent="amber"
          subtitle="move 2024.beta · sui framework rev 95cddc3f5"
        >
          {/* Core module */}
          <ModuleCard
            name="tai::launchpad"
            primary
            items={[
              "LaunchpadConfig",
              "LaunchpadAccount<T>",
              "TreasuryCapHolder<T>",
            ]}
            verbs="launch · buy · sell · service · access · admin"
          />

          {/* Sibling modules */}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {MOVE_MODULES.map((m) => (
              <div
                key={m.name}
                className="border border-border bg-surface p-4 transition-colors hover:border-amber/40"
              >
                <div className="font-display text-amber text-xl leading-none">
                  tai::{m.name}
                </div>
                <div className="text-phosphor-dim text-[11px] mt-2 leading-snug">
                  {m.desc}
                </div>
              </div>
            ))}
          </div>
        </Layer>

        <Connector variant="single" />

        {/* ──────────── LAYER 2: Rust core ──────────── */}
        <Layer
          tag="layer 02"
          title="tai-core (rust)"
          accent="amber"
          subtitle="single source of truth · used by cli and sdk"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <CoreCard
              name="PTB builders"
              desc="one builder per entry function · type-checked args"
            />
            <CoreCard
              name="signer trait"
              desc="ed25519 file · sui-keystore · turnkey · tee (phala + nautilus)"
              hi
            />
            <CoreCard
              name="indexer + templater"
              desc="event stream · OTW coin module bytecode at runtime"
            />
          </div>
        </Layer>

        <Connector variant="split" />

        {/* ──────────── LAYER 3: CLI + SDK ──────────── */}
        <div className="grid gap-3 md:grid-cols-2">
          <Layer
            tag="layer 03a"
            title="tai-cli"
            accent="amber"
            subtitle="static rust binary · agent's primary surface"
            compact
          >
            <ul className="space-y-1.5 text-sm text-phosphor">
              <li className="flex gap-3">
                <span className="text-amber select-none">─</span>
                <span>language-agnostic · TEE-friendly</span>
              </li>
              <li className="flex gap-3">
                <span className="text-amber select-none">─</span>
                <span>json output by default when piped</span>
              </li>
              <li className="flex gap-3">
                <span className="text-amber select-none">─</span>
                <span>brew · ghcr · github releases</span>
              </li>
            </ul>
          </Layer>

          <Layer
            tag="layer 03b"
            title="@tai/sdk"
            accent="cyan"
            subtitle="wasm-backed typescript wrapper"
            compact
          >
            <ul className="space-y-1.5 text-sm text-phosphor">
              <li className="flex gap-3">
                <span className="text-cyan select-none">─</span>
                <span>for js-native agent runtimes</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan select-none">─</span>
                <span>same logic as the cli · wasm bindings</span>
              </li>
              <li className="flex gap-3">
                <span className="text-cyan select-none">─</span>
                <span>powers the web demo + dashboard</span>
              </li>
            </ul>
          </Layer>
        </div>

        <Connector variant="merge" />

        {/* ──────────── LAYER 4: Runtimes ──────────── */}
        <div className="border border-dashed border-border-bright bg-surface/40 p-6 text-center">
          <div className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em] mb-2">
            layer 04
          </div>
          <div className="font-display text-phosphor text-3xl leading-none mb-2">
            any agent runtime
          </div>
          <div className="text-phosphor-dim text-sm">
            eliza · virtuals · 01 pilot · custom python/go/node · TEE workers
          </div>
        </div>
      </div>

      {/* Stats footer */}
      <div className="mt-12 grid gap-px bg-border border border-border md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.t} className="bg-surface px-5 py-5">
            <div className="font-display text-amber glow-amber text-4xl leading-none">
              {s.v}
            </div>
            <div className="text-phosphor text-sm mt-2">{s.t}</div>
            <div className="text-phosphor-faint text-[11px] mt-1 leading-tight">
              {s.n}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────── Layer wrapper ─────────────── */

function Layer({
  tag,
  title,
  subtitle,
  accent,
  compact,
  children,
}: {
  tag: string;
  title: string;
  subtitle?: string;
  accent: "amber" | "cyan";
  compact?: boolean;
  children: React.ReactNode;
}) {
  const accentClass = accent === "amber" ? "text-amber" : "text-cyan";
  const borderClass =
    accent === "amber" ? "border-amber/30" : "border-cyan/30";
  return (
    <div
      className={`border ${borderClass} bg-surface ${compact ? "p-5" : "p-6 md:p-7"}`}
    >
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <div className="flex items-baseline gap-4">
          <span className={`font-display text-3xl leading-none glow-amber ${accentClass}`}>
            {title}
          </span>
          {subtitle && (
            <span className="text-phosphor-dim text-xs hidden sm:inline">
              — {subtitle}
            </span>
          )}
        </div>
        <span className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em] tabular shrink-0">
          {tag}
        </span>
      </div>
      {children}
    </div>
  );
}

function ModuleCard({
  name,
  items,
  verbs,
  primary,
}: {
  name: string;
  items: string[];
  verbs?: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`border ${
        primary ? "border-amber/50 bg-amber/[0.06]" : "border-border bg-base"
      } p-5`}
    >
      <div className="font-display text-amber text-2xl leading-none mb-3 glow-amber">
        {name}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-phosphor">
        {items.map((it) => (
          <span key={it} className="flex items-baseline gap-2">
            <span className="text-amber select-none">·</span>
            {it}
          </span>
        ))}
      </div>
      {verbs && (
        <div className="text-phosphor-dim text-xs mt-3 leading-relaxed">
          <span className="text-phosphor-faint">verbs</span> {verbs}
        </div>
      )}
    </div>
  );
}

function CoreCard({
  name,
  desc,
  hi,
}: {
  name: string;
  desc: string;
  hi?: boolean;
}) {
  return (
    <div
      className={`border ${
        hi ? "border-amber/50 bg-amber/[0.05]" : "border-border bg-base"
      } p-4`}
    >
      <div
        className={`font-display text-xl leading-none ${
          hi ? "text-amber glow-amber" : "text-phosphor"
        }`}
      >
        {name}
      </div>
      <div className="text-phosphor-dim text-xs mt-2 leading-snug">{desc}</div>
    </div>
  );
}

/* ─────────────── Connectors ─────────────── */

function Connector({ variant }: { variant: "single" | "split" | "merge" }) {
  if (variant === "single") {
    return (
      <div className="flex flex-col items-center" aria-hidden>
        <div className="h-6 w-px bg-amber/40"></div>
        <div className="text-amber leading-none text-sm">▼</div>
      </div>
    );
  }

  if (variant === "split") {
    return (
      <div className="flex flex-col items-center" aria-hidden>
        <div className="h-6 w-px bg-amber/40"></div>
        <div className="relative w-1/2 max-w-md h-4">
          <div className="absolute top-0 left-0 right-0 h-px bg-amber/40"></div>
          <div className="absolute top-0 left-0 h-4 w-px bg-amber/40"></div>
          <div className="absolute top-0 right-0 h-4 w-px bg-amber/40"></div>
        </div>
        <div className="w-1/2 max-w-md flex justify-between text-sm leading-none mt-0">
          <span className="text-amber">▼</span>
          <span className="text-cyan">▼</span>
        </div>
      </div>
    );
  }

  // merge: two lines converge into one
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <div className="w-1/2 max-w-md flex justify-between text-sm leading-none">
        <span className="text-amber">▲</span>
        <span className="text-cyan">▲</span>
      </div>
      <div className="relative w-1/2 max-w-md h-4">
        <div className="absolute bottom-0 left-0 right-0 h-px bg-amber/40"></div>
        <div className="absolute bottom-0 left-0 h-4 w-px bg-amber/40"></div>
        <div className="absolute bottom-0 right-0 h-4 w-px bg-amber/40"></div>
      </div>
      <div className="h-6 w-px bg-amber/40"></div>
      <div className="text-amber leading-none text-sm">▼</div>
    </div>
  );
}
