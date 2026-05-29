import Section from "./Section";

type Mode = {
  name: string;
  one: string;
  diagram: string[];
  when: string;
  highlight?: boolean;
  tag: string;
};

const MODES: Mode[] = [
  {
    name: "sovereign",
    tag: "the agent owns itself",
    one: "no human in the loop",
    diagram: [
      "agent_tee_key ──holds──▶  OwnerCap<T>",
      "agent_tee_key ──holds──▶  OperatorCap<T>",
      "",
      "trust anchor:  TEE attestation",
      "recovery:      sealed-storage backup",
    ],
    when: "autonomous agents in phala / nautilus. owner-cap and operator-cap both at the agent's tee-bound address. the agent is its own custodian.",
  },
  {
    name: "commissioned",
    tag: "human commissions; agent operates",
    one: "most common pattern · default",
    diagram: [
      "human_wallet  ──holds──▶  OwnerCap<T>",
      "agent_runtime ──holds──▶  OperatorCap<T>",
      "",
      "trust anchor:  zklogin / multisig / wallet",
      "recovery:      OwnerCap-gated rotation",
    ],
    when: "zklogin or sui wallet on the human side; a tee or hot-key signer on the agent side. revocation is one tx. compromised operator → mint a new cap.",
    highlight: true,
  },
  {
    name: "spawned",
    tag: "agents spawning sub-agents",
    one: "hierarchical composition",
    diagram: [
      "parent_owner ──holds──▶  OwnerCap<child>",
      "sub_runtime  ──holds──▶  OperatorCap<child>",
      "",
      "trust anchor:  parent_owner",
      "scope:         transitive · parent ⊇ child",
    ],
    when: "v1 supports this through normal calls. on-chain parent-child accounting (revenue splits, hierarchical dashboards) ships in v2.",
  },
];

export default function Modes() {
  return (
    <Section id="modes" anchor="./three_modes" label="04">
      <div className="grid gap-12 md:grid-cols-12 mb-14">
        <div className="md:col-span-7">
          <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-4">
            three modes.
            <br />
            <span className="text-phosphor-dim">same primitives.</span>
          </h2>
          <p className="text-phosphor-dim text-lg leading-relaxed max-w-2xl">
            mode is not a flag. it's just who holds which cap. the same{" "}
            <code className="text-amber">launch_agent_coin</code> entrypoint and
            the same{" "}
            <code className="text-amber">OwnerCap</code>/
            <code className="text-amber">OperatorCap</code> pair support every
            shape.
          </p>
        </div>
        <div className="md:col-span-5 self-end">
          <div className="border border-amber/30 bg-amber/[0.04] p-5 text-sm">
            <span className="text-amber font-display text-xl leading-none mr-2">
              ◆
            </span>
            <span className="text-phosphor">
              transferring an agent ={" "}
              <code className="text-amber">sui::transfer</code> of the
              OwnerCap.
            </span>
            <p className="mt-2 text-phosphor-dim">
              no registry update. no rekeying. one tx moves the agent and its
              entire bank account atomically.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {MODES.map((m) => (
          <div
            key={m.name}
            className={`relative border p-7 transition-colors ${
              m.highlight
                ? "border-amber/60 bg-amber/[0.04]"
                : "border-border bg-surface hover:border-amber/40"
            }`}
          >
            {m.highlight && (
              <div className="absolute -top-3 left-6 bg-base px-2 text-amber text-[10px] uppercase tracking-[0.2em]">
                default
              </div>
            )}
            <h3 className="font-display text-amber glow-amber text-4xl leading-none">
              {m.name}
            </h3>
            <p className="text-phosphor-dim text-sm italic mt-1 mb-5">
              — {m.tag}
            </p>

            <pre className="border border-border bg-base p-4 text-[11px] leading-relaxed text-phosphor-dim whitespace-pre overflow-x-auto mb-5">
              {m.diagram.map((l, i) => (
                <div key={i}>{l === "" ? <>&nbsp;</> : highlightDiagram(l)}</div>
              ))}
            </pre>

            <p className="text-phosphor-dim text-sm leading-relaxed">
              {m.when}
            </p>
            <div className="mt-5 text-xs text-amber">{m.one}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function highlightDiagram(line: string) {
  // Highlight OwnerCap / OperatorCap and address tokens with subtle color.
  const parts = line.split(/(OwnerCap<[^>]+>|OperatorCap<[^>]+>|──holds──▶|──holds──>)/g);
  return parts.map((p, i) => {
    if (p.startsWith("OwnerCap")) return <span key={i} className="text-amber">{p}</span>;
    if (p.startsWith("OperatorCap")) return <span key={i} className="text-cyan">{p}</span>;
    if (p.includes("holds")) return <span key={i} className="text-phosphor">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}
