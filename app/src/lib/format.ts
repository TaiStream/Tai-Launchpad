/**
 * Tiny formatting layer. Everything that touches BigInt presentation lives here.
 */

const SUI_DECIMALS = 9n;

/** Format a u64 MIST as a SUI string with `digits` decimals. */
export function mistToSui(mist: bigint | number, digits = 4): string {
  const m = typeof mist === "bigint" ? mist : BigInt(mist);
  const sign = m < 0n ? "-" : "";
  const abs = m < 0n ? -m : m;
  const divisor = 10n ** SUI_DECIMALS;
  const whole = abs / divisor;
  const frac = abs % divisor;
  if (digits === 0) return `${sign}${whole.toString()}`;
  const fracStr = frac.toString().padStart(Number(SUI_DECIMALS), "0").slice(0, digits);
  return `${sign}${whole.toString()}.${fracStr}`;
}

/** Format an arbitrary base-unit u64 with the given coin decimals. */
export function unitsToCoin(
  units: bigint | number,
  decimals: number,
  digits = 2,
): string {
  const u = typeof units === "bigint" ? units : BigInt(units);
  const sign = u < 0n ? "-" : "";
  const abs = u < 0n ? -u : u;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  if (digits === 0) return `${sign}${whole.toString()}`;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, digits);
  return `${sign}${withGrouping(whole.toString())}.${fracStr}`;
}

/** Add thin-space grouping to a whole-number string. */
export function withGrouping(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Format bps as a percent: 100 -> "1.00%". */
export function bps(value: bigint | number, digits = 2): string {
  const v = typeof value === "bigint" ? Number(value) : value;
  return `${(v / 100).toFixed(digits)}%`;
}

/** Format the cred multiplier in bps as `1.42x`. */
export function multBpsToX(multBps: bigint, digits = 2): string {
  const x = Number(multBps) / 10_000;
  return `${x.toFixed(digits)}x`;
}

/** Compact address: 0xabcd…1234. */
export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (!addr.startsWith("0x")) return addr;
  if (addr.length <= 2 + head + tail + 1) return addr;
  return `${addr.slice(0, 2 + head)}…${addr.slice(-tail)}`;
}

/** Coin-type compactor: 0xabcd…1234::module::TYPE. */
export function shortType(t: string): string {
  if (!t.includes("::")) return shortAddr(t);
  const [addr, ...rest] = t.split("::");
  return `${shortAddr(addr)}::${rest.join("::")}`;
}

const SECONDS = 1000;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

/** Human-readable elapsed time, refresh-friendly. "12s ago", "3m ago", "1h ago", "2d ago". */
export function timeAgo(ms: bigint | number, now = Date.now()): string {
  const tm = typeof ms === "bigint" ? Number(ms) : ms;
  const delta = Math.max(0, now - tm);
  if (delta < 10 * SECONDS) return "just now";
  if (delta < MINUTES) return `${Math.floor(delta / SECONDS)}s ago`;
  if (delta < HOURS) return `${Math.floor(delta / MINUTES)}m ago`;
  if (delta < DAYS) return `${Math.floor(delta / HOURS)}h ago`;
  return `${Math.floor(delta / DAYS)}d ago`;
}

/** Absolute UTC stamp, YYYY-MM-DD HH:MM:SS. */
export function utcStamp(ms: bigint | number): string {
  const tm = typeof ms === "bigint" ? Number(ms) : ms;
  const d = new Date(tm);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}
