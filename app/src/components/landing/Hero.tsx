import { ReactNode } from "react";

type Line =
  | { kind: "prompt"; text: string }
  | { kind: "indent"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "info"; text: string }
  | { kind: "blank" }
  | { kind: "json"; text: string }
  | { kind: "json-key"; key: string; value: string };

const SESSION: Line[] = [
  { kind: "prompt", text: "tai init --signer-mode tee --network testnet" },
  { kind: "ok", text: "config written to ~/.tai/config.toml" },
  { kind: "ok", text: "signer: phala-cloud-tee · nautilus attestation verified" },
  { kind: "blank" },
  { kind: "prompt", text: "tai launch \\" },
  { kind: "indent", text: '--name "Larry the Analyst" --symbol LARRY \\' },
  { kind: "indent", text: "--owner-cap-recipient $AGENT_ADDR \\" },
  { kind: "indent", text: "--operator-cap-recipient $AGENT_ADDR \\" },
  { kind: "indent", text: "--operator-daily-limit-sui 10000000000 \\" },
  { kind: "indent", text: "--output json" },
  { kind: "blank" },
  { kind: "info", text: "publishing coin module ......................... tx 1/2 ok" },
  { kind: "info", text: "launching agent + treasury + caps .............. tx 2/2 ok" },
  { kind: "blank" },
  { kind: "json", text: "{" },
  { kind: "json-key", key: '  "launchpad_id"', value: '"0xc4a8...e3f1"' },
  { kind: "json-key", key: '  "agent_treasury_id"', value: '"0x71fb...0a92"' },
  { kind: "json-key", key: '  "owner_cap_id"', value: '"0x9e21...44dc"' },
  { kind: "json-key", key: '  "operator_cap_id"', value: '"0x55cd...7b1f"' },
  { kind: "json-key", key: '  "coin_type"', value: '"0xabc::larry::LARRY"' },
  { kind: "json", text: "}" },
];

const STEP_MS = 85;

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden border-b border-border"
    >
      {/* corner ornaments */}
      <CornerMarks />

      <div className="mx-auto grid max-w-[1240px] gap-12 px-6 pt-14 pb-24 md:grid-cols-12 md:pt-20 md:pb-32">
        {/* Left column — copy */}
        <div className="md:col-span-7 flex flex-col justify-center">
          <BannerStrip />

          <h1 className="font-display text-amber glow-amber-strong flicker-text leading-[0.85] tracking-tight text-[150px] sm:text-[200px] md:text-[260px] mt-6 -ml-1">
            tai
          </h1>

          <div className="mt-2 mb-8 flex items-center gap-3 text-phosphor-dim text-sm">
            <span className="font-display text-2xl text-amber leading-none">
              ┌──
            </span>
            <span>tokenized agentic infrastructure</span>
            <span className="font-display text-2xl text-amber leading-none">
              ──┐
            </span>
          </div>

          <p className="text-2xl md:text-[28px] text-phosphor leading-[1.25] max-w-xl">
            give your agent a name, a coin, a treasury, and a hire price —{" "}
            <span className="text-amber glow-amber">
              in one shell command.
            </span>
          </p>

          <p className="text-phosphor-dim mt-6 leading-relaxed max-w-xl">
            tai is the asset, treasury, and capability layer for AI agents on
            sui. productive creator coins. NAV that grows from real work, not
            just speculation. move-enforced custody. accessed primarily through
            a rust CLI any runtime can invoke.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <a
              href="/agents"
              className="group flex items-center gap-3 border border-amber/60 bg-amber/[0.08] px-5 py-3 text-amber hover:bg-amber hover:text-base transition-colors"
            >
              <span className="font-display text-xl leading-none text-amber-bright group-hover:text-base">
                ▶
              </span>
              <span>explore live agents</span>
            </a>
            <a
              href="/start"
              className="group flex items-center gap-3 border border-border-bright px-5 py-3 text-phosphor hover:border-amber/60 hover:bg-surface transition-colors"
            >
              <span className="text-amber">$</span>
              <span>launch your agent</span>
            </a>
            <a
              href="#cli"
              className="group flex items-center gap-3 px-2 py-3 text-phosphor-dim hover:text-amber transition-colors"
            >
              <span>see the cli ↓</span>
            </a>
          </div>

          <KeyStats />
        </div>

        {/* Right column — terminal cast */}
        <div className="md:col-span-5 flex flex-col justify-center">
          <TerminalCast />
        </div>
      </div>
    </section>
  );
}

function BannerStrip() {
  return (
    <div className="text-xs text-phosphor-dim flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-amber">●</span>
      <span>
        <span className="text-phosphor">tai network</span>{" "}
        <span className="text-phosphor-faint">·</span> launchpad
      </span>
      <span className="text-phosphor-faint">|</span>
      <span>
        v1 · <span className="text-phosphor">live on sui testnet</span> · 94 move + 40 rust tests
      </span>
      <span className="text-phosphor-faint">|</span>
      <span>
        chain · <span className="text-phosphor">sui</span> (move 2024.beta)
      </span>
      <span className="text-phosphor-faint">|</span>
      <span>
        no SAI dep · no Ika dep <span className="text-phosphor-faint">(v1.1)</span>
      </span>
    </div>
  );
}

function KeyStats() {
  const stats = [
    { v: "2", t: "txs to launch", n: "publish + launch" },
    { v: "0", t: "seed sui required", n: "virtual reserves" },
    { v: "u128", t: "overflow-safe", n: "every product" },
    { v: "100%", t: "object-bound", n: "transferable caps" },
  ];
  return (
    <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-px bg-border border border-border">
      {stats.map((s) => (
        <div key={s.t} className="bg-base px-4 py-3">
          <div className="font-display text-amber glow-amber text-3xl leading-none">
            {s.v}
          </div>
          <div className="text-phosphor text-xs mt-1">{s.t}</div>
          <div className="text-phosphor-faint text-[10px] uppercase tracking-widest mt-0.5">
            {s.n}
          </div>
        </div>
      ))}
    </div>
  );
}

function TerminalCast() {
  const titleEnd = "[REC]";
  return (
    <div className="relative">
      <div className="absolute -top-3 -left-3 hidden md:block font-display text-phosphor-faint text-sm">
        ╭{"─".repeat(36)}╮
      </div>
      <div className="absolute -bottom-3 -right-3 hidden md:block font-display text-phosphor-faint text-sm">
        ╰{"─".repeat(36)}╯
      </div>

      <div className="relative bg-surface border border-border-bright shadow-[0_0_80px_-20px_rgba(245,165,36,0.25)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-phosphor-dim">
          <div className="flex items-center gap-3">
            <span className="size-2 bg-amber/70"></span>
            <span className="size-2 bg-phosphor-faint"></span>
            <span className="size-2 bg-phosphor-faint"></span>
            <span className="ml-2 text-phosphor">~ /agent/larry</span>
            <span className="text-phosphor-faint">$ launch.session</span>
          </div>
          <span className="text-mint glow-soft">{titleEnd}</span>
        </div>
        <div className="px-5 py-5 text-[13px] md:text-sm leading-[1.65] font-mono min-h-[420px]">
          {SESSION.map((line, i) => (
            <div
              key={i}
              className="reveal"
              style={{ animationDelay: `${i * STEP_MS}ms` }}
            >
              {renderLine(line)}
            </div>
          ))}
          <div
            className="reveal mt-2"
            style={{ animationDelay: `${SESSION.length * STEP_MS}ms` }}
          >
            <span className="text-amber">$</span>
            <span className="cursor" aria-hidden></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderLine(line: Line): ReactNode {
  switch (line.kind) {
    case "prompt":
      return (
        <div className="flex gap-2">
          <span className="text-amber select-none">$</span>
          <span className="text-phosphor">{line.text}</span>
        </div>
      );
    case "indent":
      return (
        <div className="flex gap-2 pl-4">
          <span className="text-phosphor-faint select-none">↪</span>
          <span className="text-phosphor">{line.text}</span>
        </div>
      );
    case "ok":
      return (
        <div className="flex gap-2 pl-2">
          <span className="text-mint glow-soft select-none">[ok]</span>
          <span className="text-phosphor-dim">{line.text}</span>
        </div>
      );
    case "info":
      return <div className="text-phosphor-dim pl-2">{line.text}</div>;
    case "blank":
      return <div>&nbsp;</div>;
    case "json":
      return <div className="text-phosphor pl-2">{line.text}</div>;
    case "json-key":
      return (
        <div className="pl-2">
          <span className="text-cyan">{line.key}</span>
          <span className="text-phosphor-dim">: </span>
          <span className="text-amber">{line.value}</span>
          <span className="text-phosphor-dim">,</span>
        </div>
      );
  }
}

function CornerMarks() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 select-none font-display text-amber/15 text-2xl"
    >
      <span className="absolute top-3 left-4">┌</span>
      <span className="absolute top-3 right-4">┐</span>
      <span className="absolute bottom-3 left-4">└</span>
      <span className="absolute bottom-3 right-4">┘</span>
    </div>
  );
}
