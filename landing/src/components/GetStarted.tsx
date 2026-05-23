import Section from "./Section";

const INSTALLS = [
  { label: "one-line install", cmd: "curl -sSf https://<org>/tai/install.sh | sh" },
  { label: "homebrew", cmd: "brew tap <org>/tai && brew install tai" },
  { label: "docker", cmd: "docker pull ghcr.io/<org>/tai-cli:latest" },
  { label: "npm (sdk)", cmd: "npm i -g @<scope>/cli" },
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
            the move package is live on{" "}
            <a
              href="https://github.com/TaiStream/Tai-Launchpad"
              className="text-amber underline decoration-dotted underline-offset-4 hover:no-underline"
            >
              github
            </a>{" "}— 5 modules, 66 tests passing, TDD throughout, u128 overflow-safe.
            curve invariant proven against integer rounding at exact-integer
            precision.
          </p>
          <p className="text-phosphor-dim text-base leading-relaxed mb-10">
            next: tai-core rust crate, tai-cli binary (with phala-cloud TEE
            signer), wasm-backed @tai/sdk, testnet publish.
          </p>

          <div className="flex flex-wrap gap-3 mb-10">
            <a
              href="https://github.com/TaiStream/Tai-Launchpad/blob/main/SPEC.md"
              className="group flex items-center gap-3 border border-amber/60 bg-amber/[0.08] px-5 py-3 text-amber hover:bg-amber hover:text-base transition-colors"
            >
              <span className="font-display text-xl leading-none text-amber-bright group-hover:text-base">
                ▸
              </span>
              <span>read SPEC.md</span>
            </a>
            <a
              href="https://github.com/TaiStream/Tai-Launchpad/blob/main/PLAN.md"
              className="flex items-center gap-3 border border-border-bright px-5 py-3 text-phosphor hover:border-amber/60 hover:bg-surface transition-colors"
            >
              <span className="text-amber">$</span>
              <span>read PLAN.md</span>
            </a>
            <a
              href="https://github.com/TaiStream/Tai-Launchpad"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 border border-border-bright px-5 py-3 text-phosphor hover:border-amber/60 hover:bg-surface transition-colors"
            >
              <span className="text-amber">↗</span>
              <span>github</span>
            </a>
          </div>

          <div className="border border-border bg-surface p-5 text-sm leading-relaxed text-phosphor-dim">
            <div className="text-amber mb-2 text-xs uppercase tracking-[0.2em]">
              the contract
            </div>
            <p className="text-phosphor">
              do not invent. if a primitive isn't in SPEC §4 or §5, it's out of
              scope. v1 has 14 phases — implement them in order, run the
              self-review checklist before declaring complete.
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
                <span className="ml-2 text-phosphor">~ $ install.sh</span>
              </div>
              <span className="text-mint glow-soft">[copy]</span>
            </div>
            <div className="divide-y divide-border">
              {INSTALLS.map((row, i) => (
                <div key={row.label} className="px-5 py-4">
                  <div className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em] mb-1.5 flex items-center justify-between">
                    <span>{row.label}</span>
                    <span className="tabular">
                      {String(i + 1).padStart(2, "0")} / {String(INSTALLS.length).padStart(2, "0")}
                    </span>
                  </div>
                  <code className="block text-amber text-sm break-all leading-relaxed">
                    {row.cmd}
                  </code>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-3 text-xs text-phosphor-faint">
              all binaries signed · sha256 verified on install · static linked
            </div>
          </div>

          <div className="mt-6 border border-amber/30 bg-amber/[0.04] p-5">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="font-display text-amber text-2xl leading-none glow-amber">
                ◆
              </span>
              <span className="text-amber text-sm uppercase tracking-[0.2em]">
                why a cli
              </span>
            </div>
            <p className="text-phosphor text-sm leading-relaxed">
              every serious chain ships one:{" "}
              <code className="text-amber">sui client</code>,{" "}
              <code className="text-amber">forge</code>,{" "}
              <code className="text-amber">solana</code>,{" "}
              <code className="text-amber">near</code>. tai matches. an agent
              runtime gets the same surface a human developer gets, no SDK
              lock-in.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
