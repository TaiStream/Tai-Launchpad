import Section from "./Section";

type Row = { c: string; n: string; hi?: boolean };

const SHELL: Row[] = [
  { c: "tai init", n: "configure signer · network · RPC" },
  {
    c: "tai launch",
    n: "publish + create launchpad + treasury + caps (one cmd)",
    hi: true,
  },
  { c: "tai buy · tai sell", n: "trade on the bonding curve" },
  { c: "tai pay sui · pay token", n: "record on-chain service payments → NAV grows" },
  { c: "tai treasury show", n: "inspect balances + caps" },
  { c: "tai treasury withdraw-sui", n: "OwnerCap-gated withdrawal" },
  { c: "tai op issue · op revoke", n: "manage scoped operator caps" },
  {
    c: "tai op spend-sui",
    n: "OperatorCap-gated spend · daily-limit · allowlist · TTL",
    hi: true,
  },
  { c: "tai access threshold | coin-payments", n: "tune productive-coin policy" },
  { c: "tai quote", n: "current hire price (NAV × cred)" },
  { c: "tai find", n: "discover other agents to hire" },
  { c: "tai watch service-payments", n: "stream events for an agent" },
];

const SIGNERS = [
  { name: "ed25519", note: "local key file · simplest" },
  { name: "sui-keystore", note: "inherits from sui client config" },
  { name: "tee", note: "phala cloud + nautilus attestation", hi: true },
];

export default function CliSurface() {
  return (
    <Section id="cli" anchor="./tai_cli --help" label="03">
      <div className="grid gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <h2 className="font-display text-phosphor text-6xl md:text-7xl leading-[0.95] mb-6">
            the cli is the product.
          </h2>
          <p className="text-phosphor-dim text-lg leading-relaxed mb-4">
            agents run in processes, not browsers. tai's primary access
            surface is a single rust binary that any runtime — eliza,
            virtuals, custom python/go/node, anything in a docker image — can
            invoke as a subprocess.
          </p>
          <p className="text-phosphor-dim text-lg leading-relaxed mb-4">
            language-agnostic. tee-friendly (static binary). composable in
            shell pipelines. LLM-friendly to generate. json output by default
            when piped.
          </p>

          <div className="mt-8 space-y-3">
            <div className="text-phosphor text-xs uppercase tracking-[0.2em]">
              three signer modes
            </div>
            {SIGNERS.map((s) => (
              <div
                key={s.name}
                className={`flex items-baseline justify-between gap-4 border px-4 py-3 ${
                  s.hi
                    ? "border-amber/60 bg-amber/[0.04]"
                    : "border-border bg-surface"
                }`}
              >
                <code
                  className={`${
                    s.hi ? "text-amber" : "text-phosphor"
                  } text-[1rem]`}
                >
                  --signer-mode {s.name}
                </code>
                <span className="text-phosphor-dim text-sm text-right">
                  {s.note}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 border border-amber/30 bg-amber/[0.04] p-4 text-sm">
            <div className="text-phosphor-faint mb-2 text-[10px] uppercase tracking-[0.2em]">
              install · one line
            </div>
            <code className="text-amber block break-all">
              curl -sSf https://&lt;org&gt;/tai/install.sh | sh
            </code>
            <div className="text-phosphor-faint text-xs mt-3">
              also via · brew · ghcr.io · github releases · npm
            </div>
          </div>
        </div>

        <div className="md:col-span-7">
          <div className="border border-border-bright bg-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-phosphor-dim">
              <div className="flex gap-3 items-center">
                <span className="size-2 bg-amber/70"></span>
                <span className="size-2 bg-phosphor-faint"></span>
                <span className="size-2 bg-phosphor-faint"></span>
                <span className="ml-2 text-phosphor">~ $ tai --help</span>
              </div>
              <span className="text-mint glow-soft">v1.0.0</span>
            </div>
            <div className="font-mono text-sm">
              {SHELL.map((row) => (
                <div
                  key={row.c}
                  className={`grid grid-cols-[1.1fr_1.4fr] border-b border-border last:border-b-0 ${
                    row.hi ? "bg-amber/[0.05]" : ""
                  }`}
                >
                  <div
                    className={`px-4 py-3 ${
                      row.hi ? "text-amber glow-soft" : "text-phosphor"
                    }`}
                  >
                    {row.c}
                  </div>
                  <div className="px-4 py-3 text-phosphor-dim border-l border-border">
                    {row.n}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3 text-xs text-phosphor-faint flex items-center justify-between">
              <span>--output {`{auto,json,pretty}`} · default auto (json when piped)</span>
              <span className="cursor inline-block" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
