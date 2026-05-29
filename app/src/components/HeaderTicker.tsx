/**
 * Ticker bar across the very top. Permanently animates left.
 * The same content is rendered twice for seamless wrap.
 */

const ITEMS = [
  "TAI v1.1 LIVE ON SUI TESTNET",
  "NAV GROWS FROM TRADES + REAL WORK",
  "MOVE-ENFORCED CUSTODY",
  "TRADE FEE 1.00%",
  "NAV / CREATOR / PLATFORM 30 / 60 / 10",
  "OPERATOR-CAP DAILY LIMIT · ALLOWLIST · TTL",
  "CRED MULTIPLIER SATURATES AT 2.00x",
  "PUBLIC TESTNET — NO REAL FUNDS",
];

export default function HeaderTicker() {
  // Each item is followed by a diamond divider so the tape reads cleanly.
  const tape = ITEMS.map((s) => `${s}  ◆  `).join("");
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-7 overflow-hidden border-b border-border bg-base">
      <div
        className="flex whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.22em] text-amber/80"
        style={{ animation: "ticker 60s linear infinite" }}
      >
        <span className="px-4 py-2">{tape}</span>
        <span className="px-4 py-2" aria-hidden>
          {tape}
        </span>
      </div>
    </div>
  );
}
