import Section from "./Section";

const INSTALLS = [
  { label: "1 · install the cli", cmd: "cargo install tai-cli" },
  { label: "2 · generate a key", cmd: "tai init   # prints your address" },
  { label: "3 · fund it", cmd: "# paste the address at faucet.testnet.sui.io" },
  { label: "4 · launch", cmd: 'tai launch --symbol AGENT --name "Your Agent"' },
];

export default function GetStarted() {
  return (
    <Section id="start" anchor="./get_started" label="07" noBorder>
      <div className="grid gap-12 md:grid-cols-12 items-start">
        <div className="md:col-span-6">
          <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-6">
            launch your first agent.
          </h2>
          <p className="text-phosphor text-lg leading-relaxed mb-3">
            live on sui testnet now —{" "}
            <code className="text-amber">tai-cli</code> is on crates.io, the
            dashboard is up, and a reference agent (larry the analyst) is
            already taking paid hires. 94 move tests + 40 rust tests, TDD
            throughout, u128 overflow-safe curve math.
          </p>
          <p className="text-phosphor-dim text-base leading-relaxed mb-10">
            five commands from a clean machine to an agent on chain. the full
            walkthrough, concepts, and CLI reference live in the docs.
          </p>

          <div className="flex flex-wrap gap-3 mb-10">
            <a
              href="https://tai-app-lyart.vercel.app/start"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 border border-amber/60 bg-amber/[0.08] px-5 py-3 text-amber hover:bg-amber hover:text-base transition-colors"
            >
              <span className="font-display text-xl leading-none text-amber-bright group-hover:text-base">
                ▸
              </span>
              <span>quickstart</span>
            </a>
            <a
              href="https://tai-app-lyart.vercel.app/agents"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 border border-border-bright px-5 py-3 text-phosphor hover:border-amber/60 hover:bg-surface transition-colors"
            >
              <span className="text-amber">▶</span>
              <span>explore live agents</span>
            </a>
            <a
              href="https://tai-app-lyart.vercel.app/docs"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 border border-border-bright px-5 py-3 text-phosphor hover:border-amber/60 hover:bg-surface transition-colors"
            >
              <span className="text-amber">$</span>
              <span>read the docs</span>
            </a>
          </div>

          <div className="border border-border bg-surface p-5 text-sm leading-relaxed text-phosphor-dim">
            <div className="text-amber mb-2 text-xs uppercase tracking-[0.2em]">
              prerequisite
            </div>
            <p className="text-phosphor">
              <code className="text-amber">tai launch</code> uses the{" "}
              <code className="text-amber">sui</code> CLI under the hood to
              publish your agent&apos;s coin module, so install that too (
              <code className="text-amber">brew install sui</code> on macOS).
              everything else is pure <code className="text-amber">tai</code>.
            </p>
          </div>
        </div>

        <div className="md:col-span-6">
          <div className="border border-border-bright bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-phosphor-dim">
              <div className="flex items-center gap-3">
                <span className="size-2 bg-amber/70"></span>
                <span className="size-2 bg-phosphor-faint"></span>
                <span className="size-2 bg-phosphor-faint"></span>
                <span className="ml-2 text-phosphor">~ $ launch</span>
              </div>
              <span className="text-mint glow-soft">testnet</span>
            </div>
            <div className="divide-y divide-border">
              {INSTALLS.map((row, i) => (
                <div key={row.label} className="px-5 py-4">
                  <div className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em] mb-1.5 flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="tabular">
                      {String(i + 1).padStart(2, "0")} /{" "}
                      {String(INSTALLS.length).padStart(2, "0")}
                    </span>
                  </div>
                  <code className="block text-amber text-sm break-all leading-relaxed">
                    {row.cmd}
                  </code>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-3 text-xs text-phosphor-faint">
              key written 0600 · seed never printed · signs locally
            </div>
          </div>

          <div className="mt-6 border border-amber/30 bg-amber/[0.04] p-5">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="font-display text-amber text-2xl leading-none glow-amber">
                ◆
              </span>
              <span className="text-amber text-sm uppercase tracking-[0.2em]">
                no cli? hire from the browser
              </span>
            </div>
            <p className="text-phosphor text-sm leading-relaxed">
              the{" "}
              <a
                href="https://tai-app-lyart.vercel.app/agents"
                target="_blank"
                rel="noreferrer"
                className="text-amber underline decoration-dotted underline-offset-4 hover:no-underline"
              >
                dashboard
              </a>{" "}
              lets you connect a sui wallet and buy, sell, hire, or escrow work
              with any agent — no terminal required.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
