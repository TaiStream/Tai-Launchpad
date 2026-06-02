import { describe, it, expect } from "vitest";
import {
  computeStanding,
  summarizePayers,
  STANDING_WEIGHTS,
  type CountedPayment,
} from "./standing";

const SUI = 1_000_000_000n; // 1 SUI in MIST

describe("computeStanding", () => {
  it("fundamental = NAV × cred (1.0x leaves NAV unchanged)", () => {
    const s = computeStanding({
      navSui: 100n * SUI,
      multBps: 10_000n,
      pooledSui: 0n,
    });
    expect(s.fundamentalSui).toBe(100n * SUI);
    expect(s.marketSui).toBe(0n);
  });

  it("cred multiplier scales the fundamental (2.0x doubles it)", () => {
    const s = computeStanding({
      navSui: 100n * SUI,
      multBps: 20_000n,
      pooledSui: 0n,
    });
    expect(s.fundamentalSui).toBe(200n * SUI);
  });

  it("blends 60/40 fundamentals/market by default", () => {
    // fundamental = 100 (NAV 100, 1.0x), market = 50 → 0.6*100 + 0.4*50 = 80
    const s = computeStanding({
      navSui: 100n * SUI,
      multBps: 10_000n,
      pooledSui: 50n * SUI,
    });
    expect(s.standingSui).toBe(80n * SUI);
  });

  it("market term is pooled SUI verbatim — no marginal-price inflation", () => {
    const s = computeStanding({
      navSui: 0n,
      multBps: 10_000n,
      pooledSui: 7n * SUI,
    });
    expect(s.marketSui).toBe(7n * SUI);
    // pure-market, zero fundamentals → only the 40% market weight contributes
    expect(s.standingSui).toBe((7n * SUI * 40n) / 100n);
  });

  it("a thin pool contributes little (intrinsic liquidity floor)", () => {
    const fat = computeStanding({ navSui: 0n, multBps: 10_000n, pooledSui: 1000n * SUI });
    const thin = computeStanding({ navSui: 0n, multBps: 10_000n, pooledSui: 1n });
    expect(thin.standingSui).toBeLessThan(fat.standingSui);
    expect(thin.standingSui).toBe(0n); // 1 MIST * 40 / 100 floors to 0
  });

  it("respects custom weights", () => {
    const s = computeStanding(
      { navSui: 100n * SUI, multBps: 10_000n, pooledSui: 100n * SUI },
      { fundamental: 90, market: 10 },
    );
    // equal inputs → standing equals either, regardless of weights
    expect(s.standingSui).toBe(100n * SUI);
  });

  it("default weights are fundamentals-leaning", () => {
    expect(STANDING_WEIGHTS.fundamental).toBeGreaterThan(STANDING_WEIGHTS.market);
  });
});

describe("summarizePayers", () => {
  const pay = (
    payer: string,
    sui: bigint,
    counted = true,
    timestampMs = 1n,
  ): CountedPayment => ({ payer, suiAmount: sui, countedTowardCred: counted, timestampMs });

  it("returns zeros for no events", () => {
    const s = summarizePayers([]);
    expect(s).toEqual({
      distinctPayers: 0,
      countedTotalSui: 0n,
      topPayerShareBps: 0,
      lastPaidMs: 0n,
      singleSourceCred: false,
    });
  });

  it("ignores uncounted (self) payments entirely", () => {
    const s = summarizePayers([
      pay("0xself", 1000n * SUI, false, 99n),
      pay("0xa", 10n * SUI, true, 5n),
    ]);
    expect(s.distinctPayers).toBe(1);
    expect(s.countedTotalSui).toBe(10n * SUI);
    expect(s.lastPaidMs).toBe(5n); // the self payment's later timestamp is excluded
  });

  it("counts distinct payers and sums per payer", () => {
    const s = summarizePayers([
      pay("0xa", 3n * SUI),
      pay("0xb", 1n * SUI),
      pay("0xa", 2n * SUI), // same payer again
    ]);
    expect(s.distinctPayers).toBe(2);
    expect(s.countedTotalSui).toBe(6n * SUI);
    // top payer 0xa has 5 of 6 → 8333 bps
    expect(s.topPayerShareBps).toBe(8333);
  });

  it("flags single-source cred (one payer is the whole reputation)", () => {
    const s = summarizePayers([pay("0xwhale", 1000n * SUI)]);
    expect(s.distinctPayers).toBe(1);
    expect(s.topPayerShareBps).toBe(10_000);
    expect(s.singleSourceCred).toBe(true);
  });

  it("does not flag single-source when breadth exists", () => {
    const s = summarizePayers([pay("0xa", 1n * SUI), pay("0xb", 1n * SUI)]);
    expect(s.singleSourceCred).toBe(false);
  });

  it("tracks most-recent counted payment for recency", () => {
    const s = summarizePayers([
      pay("0xa", 1n * SUI, true, 100n),
      pay("0xb", 1n * SUI, true, 250n),
      pay("0xc", 1n * SUI, true, 175n),
    ]);
    expect(s.lastPaidMs).toBe(250n);
  });
});
