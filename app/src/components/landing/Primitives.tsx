import Section from "./Section";

type Item = {
  n: string;
  name: string;
  one: string;
  desc: string;
  code: string[];
};

const ITEMS: Item[] = [
  {
    n: "01",
    name: "bonding curve",
    one: "constant product with virtual reserves",
    desc: "zero seed capital. first buyer funds the pool. u128 overflow-safe arithmetic with mandatory slippage protection. trades parallelize across agents because LaunchpadConfig is immutable on the hot path.",
    code: [
      "k = (real_sui + virtual_sui)",
      "      × (real_token + virtual_token)",
      "",
      "default: 10k virtual SUI · 1.073B virtual tokens",
      "         800M sale · 200M LP locked",
      "         1% trade fee",
    ],
  },
  {
    n: "02",
    name: "dual NAV",
    one: "treasury that grows from trading AND work",
    desc: "nav_sui and nav_token accumulate from trade fees AND on-chain service payments. NAV is the productive treasury — non-withdrawable, backs the hire-price view. distinct from the agent's spendable AgentTreasury.",
    code: [
      "trade fee  →  30% nav · 60% creator · 10% platform",
      "service    →  40% nav · 50% creator · 10% platform",
      "service-T  →  40% nav · 50% burn    · 10% creator",
    ],
  },
  {
    n: "03",
    name: "productive coin",
    one: "the token is a hire ticket, access pass, claim",
    desc: "optional access_threshold gates hire by holding ≥ N tokens. optional accept_coin_payments turns hire fees into demand for the token (with burn). the token has utility beyond speculation.",
    code: [
      "tai access threshold      --value 100000000000",
      "tai access coin-payments  --enable",
      "tai access linked-identity --identity 0xsai...",
    ],
  },
  {
    n: "04",
    name: "object-bound custody",
    one: "the agent's bank account is itself an object",
    desc: "AgentTreasury<T> sibling object holds working capital. OwnerCap (transferable, sovereign) and scoped OperatorCap (daily limit, allowlist, TTL, revocation) gate every withdrawal. compromise rotates a cap; the treasury stays safe.",
    code: [
      "tai op issue \\",
      "  --treasury $T --owner-cap $C \\",
      "  --recipient $RUNTIME \\",
      "  --daily-limit 10000000000 \\",
      "  --allowlist $ALLOWED --ttl-days 30",
    ],
  },
];

export default function Primitives() {
  return (
    <Section id="primitives" anchor="./what_tai_launches" label="02">
      <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-4">
        four primitives.
      </h2>
      <p className="text-phosphor-dim text-lg max-w-2xl mb-14 leading-relaxed">
        each one is a small move module. together they turn an agent into a
        real, productive, transferable asset — not just a memecoin with a face.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        {ITEMS.map((item) => (
          <article
            key={item.n}
            className="group relative border border-border bg-surface p-7 transition-colors hover:border-amber/40 hover:bg-surface-2"
          >
            <div className="flex items-baseline justify-between mb-4">
              <span className="font-display text-amber/70 text-4xl leading-none transition-all group-hover:text-amber group-hover:glow-amber-strong">
                {item.n}
              </span>
              <span className="text-phosphor-faint text-[10px] uppercase tracking-[0.2em]">
                primitive · {item.n}
              </span>
            </div>
            <h3 className="font-display text-amber text-3xl leading-none mb-2 glow-amber">
              {item.name}
            </h3>
            <p className="text-phosphor-dim text-sm italic mb-5">
              — {item.one}
            </p>
            <p className="text-phosphor text-sm leading-relaxed mb-6">
              {item.desc}
            </p>
            <pre className="border border-border bg-base p-4 text-xs leading-relaxed text-phosphor-dim whitespace-pre overflow-x-auto">
              {item.code.map((line, i) => (
                <div key={i}>
                  {line === "" ? <>&nbsp;</> : line}
                </div>
              ))}
            </pre>
          </article>
        ))}
      </div>
    </Section>
  );
}
