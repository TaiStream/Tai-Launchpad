import Section from "./Section";

type Entry = {
  v: string;
  when: string;
  state: string;
  items: string[];
  active?: boolean;
};

const ENTRIES: Entry[] = [
  {
    v: "v1",
    when: "live on sui testnet",
    state: "move package shipped · 97 move + 40 rust tests · ~0.12 SUI to publish",
    items: [
      "move package · launchpad + bonding_curve + fees + agent_treasury + views",
      "v1.0.1 · 0xb41f…6909 · LaunchpadConfig · 0xe2ec…a1f0 · Display<OwnerCap<T>> wallet card",
      "TDD throughout · u128 overflow-safe · curve invariant proven",
      "tai-core rust crate · tai-cli binary · TEE signer (phala cloud + nautilus) — next",
      "wasm-backed @tai/sdk for js-native runtimes — next",
    ],
    active: true,
  },
  {
    v: "v1.1",
    when: "post-v1",
    state: "scoped · adapter package",
    items: [
      "Tai-Ika-Adapter · cross-chain custody via dWallets",
      "BTC · EVM · solana · EdDSA-family chains, all under OperatorCap policy",
      "dwallets_object_id field already reserved on LaunchpadAccount",
    ],
  },
  {
    v: "v1.5",
    when: "later",
    state: "planned",
    items: [
      "Tai-SAI-Adapter · compose SAI cred with Tai self-referential cred",
      "holder distribution claim flow · per-holder accrual or merkle",
      "cetus mirror pool · USDC-quoted curves · one-tx launch",
      "cred decay · kiosk integration for agent-owned NFTs",
    ],
  },
  {
    v: "v2",
    when: "future",
    state: "deferred",
    items: [
      "deepbook integration (volume-gated)",
      "on-chain hire-flow object · escrow + completion attestation",
      "capability lending · sub-agent revenue splits · collateral adapter",
    ],
  },
];

export default function Roadmap() {
  return (
    <Section id="roadmap" anchor="./roadmap" label="06">
      <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-4">
        what ships when.
      </h2>
      <p className="text-phosphor-dim text-lg max-w-2xl mb-12 leading-relaxed">
        v1 is locked. extensions live in sibling adapter packages so the core
        stays lean and auditable. nothing leaks in by accident.
      </p>

      <div className="relative space-y-px">
        <div
          aria-hidden
          className="absolute left-[100px] top-0 bottom-0 w-px bg-border-bright hidden md:block"
        />
        {ENTRIES.map((e, i) => (
          <div
            key={e.v}
            className={`relative border ${
              e.active
                ? "border-amber/60 bg-amber/[0.05]"
                : "border-border bg-surface"
            } p-6 md:p-8 transition-colors hover:border-amber/40`}
          >
            <div className="grid gap-8 md:grid-cols-[200px_1fr] items-start">
              <div className="relative">
                <div className="font-display text-amber glow-amber text-5xl md:text-6xl leading-none">
                  {e.v}
                </div>
                <div className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em] mt-2">
                  {e.when}
                </div>
                <div className="text-phosphor-dim text-xs mt-1">{e.state}</div>
                {e.active && (
                  <div className="text-mint text-xs mt-3 flex items-center gap-2">
                    <span className="font-display text-base leading-none glow-soft">
                      ▶
                    </span>
                    <span>now</span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                {e.items.map((it, j) => (
                  <div
                    key={j}
                    className="flex gap-3 text-phosphor leading-relaxed"
                  >
                    <span className="text-phosphor-faint select-none">─</span>
                    <span>{it}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase index */}
            <div className="absolute top-3 right-4 text-phosphor-faint text-[10px] uppercase tracking-[0.2em] tabular hidden md:block">
              phase / {String(i + 1).padStart(2, "0")}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
