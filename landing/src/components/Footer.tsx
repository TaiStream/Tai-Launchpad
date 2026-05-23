const COLUMNS = [
  {
    title: "docs",
    links: [
      { label: "README", href: "../README.md" },
      { label: "SPEC", href: "../SPEC.md" },
      { label: "PLAN", href: "../PLAN.md" },
    ],
  },
  {
    title: "code",
    links: [
      { label: "move/", href: "../move/" },
      { label: "rust/tai-cli/", href: "../rust/tai-cli/" },
      { label: "sdk/", href: "../sdk/" },
    ],
  },
  {
    title: "siblings",
    links: [
      { label: "SAI", href: "../../SAI-SuiAgentIndex" },
      { label: "Tai Live", href: "../../Tai-Live" },
      { label: "Tai Meet", href: "../../Tai-Meet" },
    ],
  },
  {
    title: "contact",
    links: [
      { label: "github", href: "#" },
      { label: "twitter", href: "#" },
      { label: "discord", href: "#" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-border-bright bg-base relative">
      <div className="mx-auto max-w-[1240px] px-6 pt-14 pb-10 grid gap-10 md:grid-cols-[1.4fr_2fr] items-start">
        <div>
          <div className="font-display text-amber text-7xl leading-none glow-amber-strong mb-3">
            tai
          </div>
          <div className="text-phosphor text-base">
            tokenized agentic infrastructure
          </div>
          <div className="text-phosphor-dim text-sm mt-1">
            the asset layer for AI agents on sui
          </div>
          <div className="text-phosphor-faint text-xs mt-4 flex items-center gap-2">
            <span className="text-amber">◇</span>
            <span>2026 · sui mainnet ready · MIT license</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="text-amber font-display text-2xl leading-none mb-3">
                {col.title}
              </div>
              <div className="space-y-1.5">
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    className="block text-phosphor-dim hover:text-amber transition-colors"
                  >
                    <span className="text-phosphor-faint">─ </span>
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-surface/40">
        <div className="mx-auto max-w-[1240px] px-6 py-4 text-xs text-phosphor-faint flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-amber">$</span>
            <span>EOF</span>
            <span className="cursor inline-block" aria-hidden />
          </div>
          <div className="font-mono">
            <span className="text-phosphor-dim">//</span> every agent should own
            its property.
          </div>
        </div>
      </div>
    </footer>
  );
}
