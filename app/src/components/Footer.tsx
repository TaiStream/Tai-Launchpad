import { TAI } from "@/lib/config";
import { shortAddr } from "@/lib/format";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface/50">
      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 text-xs text-phosphor-dim md:grid-cols-3 md:px-8">
        <div>
          <div className="mb-2 font-display text-base text-amber-bright">
            tai // app
          </div>
          <p className="leading-relaxed">
            Read-only operator dashboard for Tai agents on Sui testnet.
            Marketing lives at{" "}
            <a
              href="https://tai-launchpad.vercel.app"
              className="text-phosphor hover:text-amber-bright"
            >
              tai-launchpad.vercel.app
            </a>
            .
          </p>
        </div>
        <div>
          <div className="mb-2 uppercase tracking-[0.2em] text-phosphor">
            on-chain
          </div>
          <div className="space-y-1.5">
            <div>
              package <span className="text-amber/90">{TAI.v1_0_2.label}</span>{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_0_2.packageId}`}
              >
                {shortAddr(TAI.v1_0_2.packageId)}
              </a>
            </div>
            <div>
              config{" "}
              <a
                className="hover:text-amber-bright"
                href={`https://suiscan.xyz/testnet/object/${TAI.v1_0_2.configId}`}
              >
                {shortAddr(TAI.v1_0_2.configId)}
              </a>
            </div>
            <div>
              legacy <span className="text-phosphor-faint">{TAI.v1_0_1.label}</span>{" "}
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
