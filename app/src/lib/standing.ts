/**
 * Agent "standing": a fundamentals-anchored discovery/ranking score, plus the
 * reputation signals the raw `cred` multiplier can't express.
 *
 * This is a DISPLAY/RANKING layer only. The on-chain hire price stays exactly
 * `NAV × cred` (manipulation-resistant: realized treasury × earned revenue).
 * Standing folds in a soft, gameable market signal, safe here, because the
 * worst a manipulator buys is a misleading sort, never extracted money.
 *
 * See docs/superpowers/specs/2026-06-02-agent-standing.md.
 */

const BPS_BASE = 10_000n;

/** Fundamentals-leaning blend weights. A market pump can move standing by at
 *  most its `market` share, and only reversibly, at fee cost. Tunable. */
export const STANDING_WEIGHTS = { fundamental: 60, market: 40 } as const;

export type StandingWeights = { fundamental: number; market: number };

export type StandingInput = {
  /** Non-withdrawable productive treasury, MIST. */
  navSui: bigint;
  /** Cred multiplier in bps (10_000 = 1.0x, 20_000 = 2.0x). */
  multBps: bigint;
  /** Pooled SUI in the bonding curve (`real_sui`), MIST. The market term:
   *  conservative + liquidity-aware by construction: a thin pool contributes
   *  little, and there is no marginal-price × supply figure to inflate. */
  pooledSui: bigint;
};

export type Standing = {
  /** Blended ranking value, MIST. */
  standingSui: bigint;
  /** NAV × cred, i.e. the hire price. Realized, hard to game. */
  fundamentalSui: bigint;
  /** Market capital actually committed (pooled SUI). */
  marketSui: bigint;
};

/**
 * standing = (wf·(NAV×cred) + wm·pooledSui) / (wf + wm)
 *
 * All MIST, all bigint. Weights are small integers; the division is the
 * weighted average, so the result stays in MIST.
 */
export function computeStanding(
  input: StandingInput,
  weights: StandingWeights = STANDING_WEIGHTS,
): Standing {
  const fundamentalSui = (input.navSui * input.multBps) / BPS_BASE;
  const marketSui = input.pooledSui;

  const wf = BigInt(weights.fundamental);
  const wm = BigInt(weights.market);
  const denom = wf + wm;
  const standingSui =
    denom === 0n ? 0n : (fundamentalSui * wf + marketSui * wm) / denom;

  return { standingSui, fundamentalSui, marketSui };
}

// ============================ reputation signals ============================

/** Minimal shape needed from a service-payment event. */
export type CountedPayment = {
  payer: string;
  suiAmount: bigint;
  countedTowardCred: boolean;
  timestampMs: bigint;
};

export type PayerSignals = {
  /** Distinct payer addresses among cred-counted payments. */
  distinctPayers: number;
  /** Sum of cred-counted payments (MIST) seen in the supplied events. */
  countedTotalSui: bigint;
  /** Largest single counted payer's share of `countedTotalSui`, in bps
   *  (10_000 = one payer is the entire counted revenue). 0 when none. */
  topPayerShareBps: number;
  /** Most recent counted payment timestamp (epoch ms). 0n when none. */
  lastPaidMs: bigint;
  /** True when there is counted revenue but it came from a single payer: the
   *  visible self-dealing / sybil tell (cred maxed by one funded wallet). */
  singleSourceCred: boolean;
};

/**
 * Aggregate cred-relevant breadth/concentration/recency from a set of payment
 * events. Self-payments are already excluded on-chain (they arrive with
 * `countedTowardCred == false`), so filtering on that flag is sufficient here.
 */
export function summarizePayers(events: CountedPayment[]): PayerSignals {
  const counted = events.filter((e) => e.countedTowardCred);

  if (counted.length === 0) {
    return {
      distinctPayers: 0,
      countedTotalSui: 0n,
      topPayerShareBps: 0,
      lastPaidMs: 0n,
      singleSourceCred: false,
    };
  }

  const byPayer = new Map<string, bigint>();
  let countedTotalSui = 0n;
  let lastPaidMs = 0n;
  for (const e of counted) {
    byPayer.set(e.payer, (byPayer.get(e.payer) ?? 0n) + e.suiAmount);
    countedTotalSui += e.suiAmount;
    if (e.timestampMs > lastPaidMs) lastPaidMs = e.timestampMs;
  }

  let topPayerSui = 0n;
  for (const v of byPayer.values()) if (v > topPayerSui) topPayerSui = v;

  const topPayerShareBps =
    countedTotalSui === 0n
      ? 0
      : Number((topPayerSui * BPS_BASE) / countedTotalSui);

  const distinctPayers = byPayer.size;
  return {
    distinctPayers,
    countedTotalSui,
    topPayerShareBps,
    lastPaidMs,
    singleSourceCred: countedTotalSui > 0n && distinctPayers <= 1,
  };
}
