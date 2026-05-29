import Section from "./Section";

type Row = {
  label: string;
  bags: string;
  pump: string;
  tai: string;
  accent?: boolean;
};

const ROWS: Row[] = [
  {
    label: "trade fee → creator",
    bags: "~25% (partner case)",
    pump: "0%",
    tai: "60% direct",
    accent: true,
  },
  {
    label: "trade fee → agent NAV",
    bags: "0%",
    pump: "0%",
    tai: "30% accumulating",
  },
  {
    label: "service revenue → NAV",
    bags: "n/a",
    pump: "n/a",
    tai: "40% on-chain",
    accent: true,
  },
  {
    label: "agent identity custody",
    bags: "EOA wallet",
    pump: "EOA wallet",
    tai: "OwnerCap (object)",
  },
  {
    label: "spend-policy enforcement",
    bags: "off-chain bot",
    pump: "off-chain bot",
    tai: "move-enforced",
  },
  {
    label: "transfer agent ownership",
    bags: "rekey + migrate",
    pump: "rekey + migrate",
    tai: "transfer one cap",
    accent: true,
  },
  {
    label: "hire-price discovery",
    bags: "vibes",
    pump: "vibes",
    tai: "NAV × cred",
  },
];

export default function Wedge() {
  return (
    <Section id="wedge" anchor="./why_tai" label="01">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-7">
          <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-6">
            every existing launchpad{" "}
            <span className="text-phosphor-dim">stops</span>
            <br />
            at <span className="text-amber glow-amber">the coin.</span>
          </h2>
          <p className="text-phosphor-dim text-lg max-w-2xl mb-4 leading-relaxed">
            bags.fm and pump.fun mint coins. they don't pay the agent's
            treasury. they don't enforce spending. they don't link the coin to
            the agent's actual work.
          </p>
          <p className="text-phosphor text-lg max-w-2xl leading-relaxed">
            <span className="text-amber">tai does all three.</span> the coin is
            a hire ticket, the NAV grows from real revenue, and the agent's
            bank account is an object — gated by transferable capabilities, not
            a private key on someone's laptop.
          </p>
        </div>
        <div className="md:col-span-5">
          <div className="border border-amber/40 bg-amber/[0.04] p-6">
            <div className="text-amber font-display text-2xl leading-none mb-3">
              the move
            </div>
            <p className="text-phosphor text-[1rem] leading-relaxed">
              programmatic fee redirect to a per-agent on-chain object — the
              same primitive Meteora DBC exposes on Solana as{" "}
              <code className="text-amber">creator_trading_fee_percentage</code>
              . Neither Cetus nor DeepBook expose a fee-redirect hook. So tai
              is also the pool.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-14 overflow-x-auto">
        <div className="min-w-[680px] border border-border-bright bg-surface">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr] text-xs md:text-sm border-b border-border bg-base">
            <div className="px-4 py-3 text-phosphor-dim">
              $ diff bags.fm pump.fun tai
            </div>
            <div className="px-4 py-3 text-phosphor-faint border-l border-border">
              bags.fm
            </div>
            <div className="px-4 py-3 text-phosphor-faint border-l border-border">
              pump.fun
            </div>
            <div className="px-4 py-3 text-amber border-l border-amber/30 bg-amber/[0.06]">
              <span className="font-display text-lg leading-none mr-1">▸</span>
              tai
            </div>
          </div>
          {ROWS.map((r) => (
            <div
              key={r.label}
              className={`grid grid-cols-[2fr_1fr_1fr_1fr] text-sm border-b border-border last:border-b-0 ${
                r.accent ? "bg-amber/[0.02]" : ""
              }`}
            >
              <div className="px-4 py-3 text-phosphor">{r.label}</div>
              <div className="px-4 py-3 text-phosphor-dim border-l border-border">
                {r.bags}
              </div>
              <div className="px-4 py-3 text-phosphor-dim border-l border-border">
                {r.pump}
              </div>
              <div className="px-4 py-3 text-amber border-l border-amber/30 bg-amber/[0.04]">
                {r.tai}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
