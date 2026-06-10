/**
 * Agent command catalog: the off-chain, Tai-curated definition of the
 * services a payer can buy from an agent. Pure logic only (no React, no
 * network) so it is unit-testable. See
 * docs/superpowers/specs/2026-05-30-agent-command-catalog-design.md
 */

export type FulfillmentMode = "sync" | "escrow";

export type CommandInput = {
  key: string;
  label: string;
  type: "text" | "textarea" | "url";
  required: boolean;
  placeholder?: string;
  maxLen?: number;
};

export type CommandPrice =
  | { mode: "fixed"; sui: string }
  | { mode: "hire_price" }
  | { mode: "min" };

export type TaiCommand = {
  id: string;
  label: string;
  description: string;
  fulfillment: FulfillmentMode;
  price: CommandPrice;
  inputs: CommandInput[];
};

/** Per-agent manifest, stored in the Tai-curated registry (agent-commands.ts). */
export type AgentManifest = {
  packageVersion: string;
  fulfillmentUrl?: string;
  commands?: TaiCommand[];
  disabledDefaults?: string[];
};

/** Floor used by the "min" price mode. 0.1 SUI. */
export const MIN_PRICE_MIST = 100_000_000n;

/** Max bytes for a work-order spec_url (matches the Move contract bound). */
export const MAX_SPEC_URL_LEN = 512;

export const TAI_DEFAULT_COMMANDS: TaiCommand[] = [
  {
    id: "ask",
    label: "Ask a question",
    description:
      "One-shot question or analysis. You pay, the agent answers inline.",
    fulfillment: "sync",
    price: { mode: "hire_price" },
    inputs: [
      {
        key: "prompt",
        label: "Your question",
        type: "textarea",
        required: true,
        placeholder: "What do you want to know?",
        maxLen: 1000,
      },
    ],
  },
  {
    id: "commission",
    label: "Commission a job",
    description:
      "A larger custom job, escrow-backed: funds release on delivery (or refund after the deadline).",
    fulfillment: "escrow",
    price: { mode: "hire_price" },
    inputs: [
      {
        key: "spec",
        label: "What you need done",
        type: "textarea",
        required: true,
        placeholder: "Describe the deliverable…",
        maxLen: 400,
      },
      {
        key: "deliverable_url",
        label: "Reference / brief URL (optional)",
        type: "url",
        required: false,
        maxLen: 100,
      },
    ],
  },
];

/**
 * Resolve the effective catalog for an agent:
 *   (defaults − disabledDefaults) with custom commands merged over by id,
 * then filtered by capability:
 *   - sync commands require a fulfillmentUrl,
 *   - escrow commands require a v1.1 agent.
 */
export function effectiveCommands(agent: AgentManifest): TaiCommand[] {
  const disabled = new Set(agent.disabledDefaults ?? []);
  const byId = new Map<string, TaiCommand>();
  for (const c of TAI_DEFAULT_COMMANDS) {
    if (!disabled.has(c.id)) byId.set(c.id, c);
  }
  for (const c of agent.commands ?? []) byId.set(c.id, c);

  return [...byId.values()].filter((c) => {
    if (c.fulfillment === "sync" && !agent.fulfillmentUrl) return false;
    if (c.fulfillment === "escrow" && agent.packageVersion !== "v1.1") return false;
    return true;
  });
}

/** SUI decimal string (dot or comma) → MIST. Throws on malformed input. */
function suiToMist(s: string): bigint {
  const t = s.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`invalid SUI amount "${s}"`);
  const [whole, frac = ""] = t.split(".");
  const fracPadded = (frac + "000000000").slice(0, 9);
  return BigInt(whole) * 1_000_000_000n + BigInt(fracPadded);
}

export function resolvePriceMist(price: CommandPrice, hirePriceMist: bigint): bigint {
  switch (price.mode) {
    case "fixed":
      return suiToMist(price.sui);
    case "hire_price":
      return hirePriceMist;
    case "min":
      return MIN_PRICE_MIST;
  }
}

/**
 * Serialize a chosen command + inputs into a work-order spec. We put a compact
 * JSON object in spec_url and leave spec_hash empty (the contract allows an
 * empty hash). Enforces the 512-byte spec_url bound.
 */
export function serializeEscrowSpec(
  commandId: string,
  inputs: Record<string, string>,
): { specUrl: string; specHash: number[] } {
  const specUrl = JSON.stringify({ c: commandId, i: inputs });
  if (new TextEncoder().encode(specUrl).length > MAX_SPEC_URL_LEN) {
    throw new Error("spec too long (max 512 bytes), shorten the inputs");
  }
  return { specUrl, specHash: [] };
}
