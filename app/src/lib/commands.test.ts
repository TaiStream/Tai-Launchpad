import { describe, it, expect } from "vitest";
import {
  TAI_DEFAULT_COMMANDS,
  effectiveCommands,
  resolvePriceMist,
  serializeEscrowSpec,
  MIN_PRICE_MIST,
  type TaiCommand,
} from "./commands";

const custom: TaiCommand = {
  id: "audit",
  label: "Audit a contract",
  description: "Review a Move module.",
  fulfillment: "escrow",
  price: { mode: "fixed", sui: "2.5" },
  inputs: [{ key: "repo", label: "Repo URL", type: "url", required: true }],
};

describe("effectiveCommands", () => {
  it("v1.1 agent with an endpoint gets ask + commission", () => {
    const ids = effectiveCommands({
      packageVersion: "v1.1",
      fulfillmentUrl: "https://x.example",
    }).map((c) => c.id);
    expect(ids).toContain("ask");
    expect(ids).toContain("commission");
  });

  it("drops sync commands when there is no fulfillment endpoint", () => {
    const ids = effectiveCommands({ packageVersion: "v1.1" }).map((c) => c.id);
    expect(ids).not.toContain("ask"); // ask is sync
    expect(ids).toContain("commission"); // escrow needs no endpoint
  });

  it("drops escrow commands for pre-v1.1 agents", () => {
    const ids = effectiveCommands({
      packageVersion: "v1.0.1",
      fulfillmentUrl: "https://x.example",
    }).map((c) => c.id);
    expect(ids).toContain("ask");
    expect(ids).not.toContain("commission");
  });

  it("respects disabledDefaults and appends custom commands", () => {
    const cmds = effectiveCommands({
      packageVersion: "v1.1",
      fulfillmentUrl: "https://x.example",
      disabledDefaults: ["ask"],
      commands: [custom],
    });
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain("ask");
    expect(ids).toContain("commission");
    expect(ids).toContain("audit");
  });

  it("a custom command overrides a default with the same id", () => {
    const cmds = effectiveCommands({
      packageVersion: "v1.1",
      fulfillmentUrl: "https://x.example",
      commands: [{ ...custom, id: "commission", fulfillment: "escrow" }],
    });
    const commission = cmds.find((c) => c.id === "commission")!;
    expect(commission.label).toBe("Audit a contract");
  });
});

describe("resolvePriceMist", () => {
  it("fixed parses SUI to MIST", () => {
    expect(resolvePriceMist({ mode: "fixed", sui: "2.5" }, 999n)).toBe(2_500_000_000n);
  });
  it("hire_price returns the passed hire price", () => {
    expect(resolvePriceMist({ mode: "hire_price" }, 40001000n)).toBe(40001000n);
  });
  it("min returns the floor", () => {
    expect(resolvePriceMist({ mode: "min" }, 999n)).toBe(MIN_PRICE_MIST);
  });
  it("accepts a comma decimal in fixed", () => {
    expect(resolvePriceMist({ mode: "fixed", sui: "0,1" }, 0n)).toBe(100_000_000n);
  });
});

describe("serializeEscrowSpec", () => {
  it("round-trips command id + inputs as JSON in specUrl, empty hash", () => {
    const { specUrl, specHash } = serializeEscrowSpec("commission", {
      spec: "build a thing",
    });
    expect(specHash).toEqual([]);
    expect(JSON.parse(specUrl)).toEqual({ c: "commission", i: { spec: "build a thing" } });
  });
  it("throws if the serialized spec exceeds 512 bytes", () => {
    expect(() =>
      serializeEscrowSpec("commission", { spec: "x".repeat(600) }),
    ).toThrow(/too long/i);
  });
});
