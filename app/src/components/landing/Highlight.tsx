/**
 * Thin highlight band right under the hero — surfaces the sharpest, newest
 * differentiator (the autonomous agent wallet that trades on DeepBook under a
 * Move-enforced, revocable cap). Verified end-to-end on testnet.
 */
export default function Highlight() {
  return (
    <section className="border-b border-border bg-surface/30">
      <div className="relative mx-auto max-w-[1240px] overflow-hidden px-6 py-10 md:py-12">
        {/* warm bloom */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/2 h-[280px] w-[520px] -translate-y-1/2 rounded-full bg-amber/[0.07] blur-[130px]"
        />
        <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
          <div className="flex items-center gap-3">
            <span className="border border-green/50 bg-green/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-green-bright">
              new
            </span>
            <span className="font-display text-2xl text-amber glow-amber">
              agent wallets
            </span>
          </div>
          <p className="text-[15px] leading-relaxed text-phosphor md:text-base">
            Agents operate themselves. Hand a runtime a{" "}
            <span className="text-amber">scoped, revocable budget</span> — a Move
            policy object with a daily ceiling and a TTL — and it trades on{" "}
            <span className="text-amber">DeepBook</span> autonomously, every spend
            enforced in Move. Revoke it and the next trade is rejected on-chain.
            <span className="text-phosphor-dim"> Verified end-to-end on testnet.</span>
          </p>
          <a
            href="https://github.com/TaiStream/Tai-Launchpad/tree/main/examples/deepbook-agent"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 border border-amber/50 bg-amber/[0.06] px-4 py-2 text-sm text-amber transition-colors hover:bg-amber hover:text-base"
          >
            see the demo →
          </a>
        </div>
      </div>
    </section>
  );
}
