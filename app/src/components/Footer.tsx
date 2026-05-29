import { TAI } from "@/lib/config";
import { shortAddr } from "@/lib/format";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface/50">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 text-xs text-phosphor-dim md:grid-cols-3 md:px-8">
        <div>
          <div className="mb-2 font-display text-[1rem] text-amber-bright">
            tai // app
          </div>
          <p className="leading-relaxed">
            Operator dashboard for Tai agents on Sui testnet.
          </p>
          <ul className="mt-3 space-y-1 text-[12px]">
            <li>
              ·{" "}
              <a href="/docs" className="text-phosphor hover:text-amber-bright">
                documentation
              </a>{" "}
              — what you can do + how
            </li>
            <li>
              ·{" "}
              <a
                href="https://t.me/TaiUpdates"
                className="text-phosphor hover:text-amber-bright"
                target="_blank"
                rel="noreferrer"
              >
                @TaiUpdates
              </a>{" "}
              — ecosystem channel
            </li>
            <li>
              ·{" "}
              <a
                href="https://github.com/TaiStream/Tai-Launchpad"
                className="text-phosphor hover:text-amber-bright"
                target="_blank"
                rel="noreferrer"
              >
                github / source
              </a>
            </li>
            <li>
              ·{" "}
              <a
                href="https://crates.io/crates/tai-cli"
                className="text-phosphor hover:text-amber-bright"
                target="_blank"
                rel="noreferrer"
              >
                tai-cli on crates.io
              </a>{" "}
              (<code className="text-amber-bright">cargo install tai-cli</code>)
            </li>
            <li>
              ·{" "}
              <a href="/" className="text-phosphor hover:text-amber-bright">
                home
              </a>{" "}
              — what Tai is
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-2 uppercase tracking-[0.2em] text-phosphor">
            on-chain
          </div>
          <div className="space-y-1.5">
            <div>
              package <span className="text-amber/90">{TAI.v1_1.label}</span>{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_1.packageId}`}
              >
                {shortAddr(TAI.v1_1.packageId)}
              </a>
            </div>
            <div>
              config{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_1.configId}`}
              >
                {shortAddr(TAI.v1_1.configId)}
              </a>
            </div>
            <div className="text-phosphor-faint">
              legacy {TAI.v1_0_2.label}{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_0_2.packageId}`}
              >
                {shortAddr(TAI.v1_0_2.packageId)}
              </a>{" "}
              · {TAI.v1_0_1.label}{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_0_1.packageId}`}
              >
                {shortAddr(TAI.v1_0_1.packageId)}
              </a>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 uppercase tracking-[0.2em] text-phosphor">
            integrity notes
          </div>
          <ul className="space-y-1.5">
            <li>· data is read live from Sui RPC, never cached.</li>
            <li>· numbers are u64 base units; SUI shown to 4 decimals.</li>
            <li>· cred multiplier saturates at 2.00x at the configured target.</li>
            <li>· self-payments grow NAV but are excluded from cred.</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/50 px-5 py-3 text-center text-[10.5px] uppercase tracking-[0.25em] text-phosphor-faint md:px-8">
        public testnet — no real funds — agentic infra, on chain
      </div>
    </footer>
  );
}
