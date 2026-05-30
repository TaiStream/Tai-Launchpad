# Agent Command Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Tai agent a menu of purchasable commands (Tai defaults `ask`/`commission` + dev-added custom ones) so "hiring" means picking a concrete service, paying, and getting a result.

**Architecture:** Off-chain, Tai-curated manifest (bundled app data) resolved per agent and rendered as a dashboard menu. `sync` commands pay via `record_service_payment_sui` then relay `{command, inputs, txDigest}` to the agent's fulfillment endpoint (after a pre-pay health ping); `escrow` commands serialize into a `work_order` spec. No smart-contract change.

**Tech Stack:** Next 16 / React 19 / TS, `@mysten/dapp-kit` + `@mysten/sui`, Vitest (new, for lib unit tests), Cloudflare Worker (reference fulfillment agent).

**Spec:** `docs/superpowers/specs/2026-05-30-agent-command-catalog-design.md`

---

## File Structure

- `app/vitest.config.ts` — **create** — Vitest config (node env) for lib unit tests.
- `app/src/lib/commands.ts` — **create** — command types, Tai defaults, `effectiveCommands`, `resolvePriceMist`, `serializeEscrowSpec`. Pure logic, fully unit-tested.
- `app/src/lib/commands.test.ts` — **create** — unit tests for the above.
- `app/src/lib/agent-commands.ts` — **create** — Tai-curated per-agent manifests (registry) + `manifestFor(id)`. Larry → `fulfillmentUrl`.
- `app/src/components/CommandRunner.tsx` — **create** — one selected command: inputs form → price → pay (sync direct / escrow work-order) → fulfill/relay.
- `app/src/components/CommandMenu.tsx` — **create** — lists effective commands, handles selection, renders `CommandRunner`.
- `app/src/app/(dashboard)/agent/[id]/page.tsx` — **modify** — replace the hire/pay Panel body with `CommandMenu`.
- `examples/cloudflare-agent/src/index.ts` — **modify** — generalize `POST /hire` to `{command, inputs, payment_tx_digest}` (keep `{question}` back-compat); add `GET /health`.
- `examples/cloudflare-agent/src/commands.ts` — **create** — command dispatch (`ask` → answer); pure-ish, unit-tested.
- `examples/cloudflare-agent/src/commands.test.ts` — **create** — dispatch unit tests.
- `examples/cloudflare-agent/vitest.config.ts` + `package.json` — **modify/create** — add vitest.
- `app/src/app/(dashboard)/docs/commands/page.tsx` — **create** — "Agent commands" doc (manifest format + fulfillment endpoint spec).
- `app/src/components/docs/DocsSidebar.tsx` — **modify** — add the new doc link.

`DirectPayForm.tsx` and `HireForm.tsx` stay as-is (still used for the bare pay/hire fallback and as the proven payment recipes `CommandRunner` mirrors). `CommandRunner` is the new front door.

---

## Task 1: Add Vitest to the app

**Files:**
- Create: `app/vitest.config.ts`
- Modify: `app/package.json`

- [ ] **Step 1: Install vitest**

Run:
```bash
cd app && npm i -D vitest@^2
```
Expected: `vitest` appears under devDependencies.

- [ ] **Step 2: Add the config**

Create `app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script**

In `app/package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Verify the runner works (no tests yet)**

Run: `cd app && npm test`
Expected: exits 0 with "No test files found" (or runs 0 tests). Not an error.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/vitest.config.ts
git commit -m "test(app): add vitest for lib unit tests"
```

---

## Task 2: Command types, defaults, and resolvers (`lib/commands.ts`)

**Files:**
- Create: `app/src/lib/commands.ts`
- Test: `app/src/lib/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/commands.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run src/lib/commands.test.ts`
Expected: FAIL — `Cannot find module './commands'`.

- [ ] **Step 3: Implement `lib/commands.ts`**

Create `app/src/lib/commands.ts`:
```ts
/**
 * Agent command catalog — the off-chain, Tai-curated definition of the
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
  return BigInt(whole) * 1_000_000_000n + BigInt(fracPadded || "0");
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
    throw new Error("spec too long (max 512 bytes) — shorten the inputs");
  }
  return { specUrl, specHash: [] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd app && npx vitest run src/lib/commands.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/commands.ts app/src/lib/commands.test.ts
git commit -m "feat(app): command catalog types, defaults, and resolvers"
```

---

## Task 3: Tai-curated per-agent registry (`lib/agent-commands.ts`)

**Files:**
- Create: `app/src/lib/agent-commands.ts`

- [ ] **Step 1: Implement the registry**

Create `app/src/lib/agent-commands.ts`:
```ts
/**
 * Tai-curated per-agent command manifests, keyed by launchpad account id.
 * This is where an agent's fulfillment endpoint and any CUSTOM commands /
 * disabled defaults live until self-serve manifests exist. Tai's default
 * commands are layered underneath by effectiveCommands() in commands.ts.
 */
import type { TaiCommand } from "./commands";

type RegistryEntry = {
  fulfillmentUrl?: string;
  commands?: TaiCommand[];
  disabledDefaults?: string[];
};

const REGISTRY: Record<string, RegistryEntry> = {
  // Larry the Analyst (v1.0.1) — sync Q&A via his Worker.
  "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e": {
    fulfillmentUrl: "https://larry-the-analyst.guanyidu98.workers.dev",
  },
};

export function manifestFor(launchpadAccountId: string): RegistryEntry {
  return REGISTRY[launchpadAccountId] ?? {};
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/agent-commands.ts
git commit -m "feat(app): Tai-curated agent command registry (Larry endpoint)"
```

---

## Task 4: `CommandRunner` component

**Files:**
- Create: `app/src/components/CommandRunner.tsx`

This renders one selected command: its inputs, the resolved price, and a pay
button that branches by fulfillment mode. It reuses the exact payment recipes
already proven in `DirectPayForm` (sync → `record_service_payment_sui` on the
agent's own package/config) and `HireForm` (escrow → `create_work_order`).

- [ ] **Step 1: Implement the component**

Create `app/src/components/CommandRunner.tsx`:
```tsx
"use client";

import { useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { TAI, suiscan, type TaiPackageInfo } from "@/lib/config";
import { mistToSui } from "@/lib/format";
import {
  resolvePriceMist,
  serializeEscrowSpec,
  type TaiCommand,
} from "@/lib/commands";

function packageFor(version: string): TaiPackageInfo {
  if (version === "v1.0.2") return TAI.v1_0_2;
  if (version === "v1.0.1") return TAI.v1_0_1;
  return TAI.v1_1;
}

function parseSuiToMist(s: string): bigint {
  const t = s.trim().replace(",", ".");
  if (t.length === 0) throw new Error("amount is empty");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`invalid amount "${s}"`);
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + "000000000").slice(0, 9) || "0");
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "unknown error";
  }
}

export default function CommandRunner({
  command,
  launchpadAccountId,
  coinType,
  packageVersion,
  hirePriceMist,
  fulfillmentUrl,
}: {
  command: TaiCommand;
  launchpadAccountId: string;
  coinType: string;
  packageVersion: string;
  hirePriceMist: bigint;
  fulfillmentUrl?: string;
}) {
  const account = useCurrentAccount();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();
  const pkg = packageFor(packageVersion);

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [priceSui, setPriceSui] = useState(
    mistToSui(resolvePriceMist(command.price, hirePriceMist), 4),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "tx"; digest: string }
    | { kind: "answer"; text: string; digest: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  function setInput(key: string, v: string) {
    setInputs((prev) => ({ ...prev, [key]: v }));
  }

  function validate(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of command.inputs) {
      const v = (inputs[f.key] ?? "").trim();
      if (f.required && !v) throw new Error(`${f.label} is required`);
      if (f.maxLen && v.length > f.maxLen)
        throw new Error(`${f.label} is too long (max ${f.maxLen})`);
      if (v) out[f.key] = v;
    }
    return out;
  }

  if (!account) {
    return (
      <p className="text-[12px] text-phosphor-dim">
        Connect a Sui wallet (top-right) to run <strong>{command.label}</strong>.
      </p>
    );
  }

  async function runSync() {
    const filled = validate();
    const amountMist = parseSuiToMist(priceSui);
    if (amountMist <= 0n) throw new Error("price must be > 0");
    if (!fulfillmentUrl) throw new Error("this agent has no fulfillment endpoint");

    // (c) Pre-pay health ping — never pay an offline agent.
    try {
      const ping = await fetch(fulfillmentUrl, { method: "GET" });
      if (!ping.ok) throw new Error();
    } catch {
      throw new Error("agent appears offline — try again later (you were not charged)");
    }

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${pkg.packageId}::launchpad::record_service_payment_sui`,
      typeArguments: [coinType],
      arguments: [
        tx.object(pkg.configId),
        tx.object(launchpadAccountId),
        coin,
        tx.object("0x6"),
      ],
    });

    const digest = await new Promise<string>((resolve, reject) => {
      signAndExecute(
        { transaction: tx },
        {
          onSuccess: ({ digest }) => resolve(digest),
          onError: (e) => reject(e),
        },
      );
    });

    // Relay to the agent for fulfillment.
    try {
      const res = await fetch(fulfillmentUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: command.id,
          inputs: filled,
          paymentTxDigest: digest,
          coinType,
          launchpadAccountId,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; result?: string; error?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error ?? `fulfillment failed (${res.status})`);
      }
      setResult({ kind: "answer", text: body.result ?? "(no content)", digest });
    } catch (e) {
      // Payment already settled — surface the digest so the payer has proof.
      setResult({
        kind: "err",
        message: `paid (tx ${digest.slice(0, 10)}…) but fulfillment failed: ${errMsg(e)}`,
      });
    }
  }

  async function runEscrow() {
    const filled = validate();
    const amountMist = parseSuiToMist(priceSui);
    if (amountMist <= 0n) throw new Error("price must be > 0");
    const { specUrl, specHash } = serializeEscrowSpec(command.id, filled);
    const deadline = BigInt(Date.now()) + 24n * 3_600_000n; // 24h
    const disputeWindow = 3_600_000n; // 1h (>= 5-min floor)

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${TAI.v1_1.packageId}::work_order::create_work_order`,
      typeArguments: [coinType],
      arguments: [
        tx.object(launchpadAccountId),
        coin,
        tx.pure.vector("u8", specHash),
        tx.pure.string(specUrl),
        tx.pure.u64(deadline),
        tx.pure.u64(disputeWindow),
        tx.object("0x6"),
      ],
    });

    const digest = await new Promise<string>((resolve, reject) => {
      signAndExecute(
        { transaction: tx },
        { onSuccess: ({ digest }) => resolve(digest), onError: (e) => reject(e) },
      );
    });
    setResult({ kind: "tx", digest });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setBusy(true);
    try {
      if (command.fulfillment === "sync") await runSync();
      else await runEscrow();
    } catch (err) {
      setResult({ kind: "err", message: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {command.inputs.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
            {f.label}
          </span>
          {f.type === "textarea" ? (
            <textarea
              value={inputs[f.key] ?? ""}
              placeholder={f.placeholder}
              maxLength={f.maxLen}
              onChange={(e) => setInput(f.key, e.target.value)}
              className="mt-1 w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
              rows={3}
            />
          ) : (
            <input
              type="text"
              value={inputs[f.key] ?? ""}
              placeholder={f.placeholder}
              maxLength={f.maxLen}
              onChange={(e) => setInput(f.key, e.target.value)}
              className="mt-1 w-full border border-border bg-base px-2 py-2 font-mono text-[12.5px] text-phosphor focus:border-amber/70 focus:outline-none"
            />
          )}
        </label>
      ))}

      <label className="block">
        <span className="block text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
          price (SUI){command.price.mode === "fixed" ? " · set by agent" : ""}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={priceSui}
          readOnly={command.price.mode === "fixed"}
          onChange={(e) => setPriceSui(e.target.value)}
          className="mt-1 w-full border border-border bg-base px-3 py-2 font-mono text-[1rem] text-amber-bright focus:border-amber/70 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={disabled}
        className="w-full border border-amber/70 bg-amber/15 py-2.5 text-[12px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled
          ? "working…"
          : command.fulfillment === "sync"
            ? "pay & run"
            : "lock escrow & commission"}
      </button>
      <p className="text-center text-[10px] uppercase tracking-[0.18em] text-phosphor-faint">
        {command.fulfillment === "sync"
          ? "instant · paid up front · no escrow"
          : "escrow · released on delivery · refundable after deadline"}
      </p>

      {result?.kind === "answer" && (
        <div className="border border-green-dim/60 bg-green/5 p-3 text-[12.5px] text-phosphor">
          <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-green-bright">
            result ·{" "}
            <a className="underline" href={suiscan("tx", result.digest)} target="_blank" rel="noreferrer">
              {result.digest.slice(0, 10)}…
            </a>
          </div>
          <div className="whitespace-pre-wrap">{result.text}</div>
        </div>
      )}
      {result?.kind === "tx" && (
        <div className="border border-green-dim/60 bg-green/5 p-3 text-[12px] text-green-bright">
          work order created ·{" "}
          <a className="underline" href={suiscan("tx", result.digest)} target="_blank" rel="noreferrer">
            {result.digest.slice(0, 10)}…
          </a>{" "}
          — see the work-order page to track delivery.
        </div>
      )}
      {result?.kind === "err" && (
        <div className="border border-red/60 bg-red/5 p-3 text-[12px] text-red-bright">
          {result.message}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/CommandRunner.tsx
git commit -m "feat(app): CommandRunner — inputs + price + pay (sync/escrow)"
```

---

## Task 5: `CommandMenu` component

**Files:**
- Create: `app/src/components/CommandMenu.tsx`

- [ ] **Step 1: Implement the component**

Create `app/src/components/CommandMenu.tsx`:
```tsx
"use client";

import { useState } from "react";
import { mistToSui } from "@/lib/format";
import { resolvePriceMist, type TaiCommand } from "@/lib/commands";
import { Tag } from "./primitives";
import CommandRunner from "./CommandRunner";

export default function CommandMenu({
  commands,
  launchpadAccountId,
  coinType,
  packageVersion,
  hirePriceMist,
  fulfillmentUrl,
}: {
  commands: TaiCommand[];
  launchpadAccountId: string;
  coinType: string;
  packageVersion: string;
  hirePriceMist: bigint;
  fulfillmentUrl?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(
    commands.length === 1 ? commands[0].id : null,
  );

  if (commands.length === 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-phosphor-dim">
        This agent has no purchasable commands configured yet. You can still pay
        it directly from the CLI (<code className="text-amber-bright">tai pay sui</code>).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {commands.map((c) => {
        const open = openId === c.id;
        const price = mistToSui(resolvePriceMist(c.price, hirePriceMist), 3);
        return (
          <div key={c.id} className="border border-border bg-surface/60">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : c.id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2/60"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] text-phosphor">{c.label}</span>
                  <Tag variant={c.fulfillment === "escrow" ? "violet" : "green"}>
                    {c.fulfillment === "escrow" ? "escrow" : "instant"}
                  </Tag>
                </span>
                <span className="block truncate text-[11.5px] text-phosphor-dim">
                  {c.description}
                </span>
              </span>
              <span className="ml-3 shrink-0 text-[12px] tabular text-amber-bright">
                {c.price.mode === "fixed" ? price : `~${price}`} SUI
              </span>
            </button>
            {open && (
              <div className="border-t border-border px-3 py-3">
                <CommandRunner
                  command={c}
                  launchpadAccountId={launchpadAccountId}
                  coinType={coinType}
                  packageVersion={packageVersion}
                  hirePriceMist={hirePriceMist}
                  fulfillmentUrl={fulfillmentUrl}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/CommandMenu.tsx
git commit -m "feat(app): CommandMenu — purchasable command list"
```

---

## Task 6: Wire the menu into the agent page

**Files:**
- Modify: `app/src/app/(dashboard)/agent/[id]/page.tsx`

- [ ] **Step 1: Add imports**

Near the existing `import HireForm ...` / `import DirectPayForm ...` lines, add:
```tsx
import CommandMenu from "@/components/CommandMenu";
import { effectiveCommands } from "@/lib/commands";
import { manifestFor } from "@/lib/agent-commands";
```

- [ ] **Step 2: Replace the hire/pay Panel body**

Find the Panel titled `"hire this agent"` (currently rendering `HireForm`/`DirectPayForm` conditionally). Replace the whole `<Panel ...>…</Panel>` with:
```tsx
{(() => {
  const manifest = manifestFor(account.objectId);
  const commands = effectiveCommands({
    packageVersion: account.packageVersion,
    fulfillmentUrl: manifest.fulfillmentUrl,
    commands: manifest.commands,
    disabledDefaults: manifest.disabledDefaults,
  });
  return (
    <Panel
      title="hire this agent"
      subtitle="pick a command · pay · get the result"
      accent="amber"
    >
      <CommandMenu
        commands={commands}
        launchpadAccountId={account.objectId}
        coinType={account.coinType}
        packageVersion={account.packageVersion}
        hirePriceMist={hirePrice}
        fulfillmentUrl={manifest.fulfillmentUrl}
      />
    </Panel>
  );
})()}
```

- [ ] **Step 3: Remove now-unused imports if the linter flags them**

If `HireForm` / `DirectPayForm` are no longer referenced on this page, remove their imports. (The components stay in the repo; they're just not imported here anymore.)

Run: `cd app && npx tsc --noEmit`
Expected: exits 0 (no unused-import errors; Next build also lints).

- [ ] **Step 4: Build**

Run: `cd app && npm run build`
Expected: "✓ Compiled successfully"; route `/agent/[id]` present.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/(dashboard)/agent/[id]/page.tsx"
git commit -m "feat(app): agent page shows the command menu"
```

---

## Task 7: Generalize the reference agent's fulfillment endpoint

**Files:**
- Create: `examples/cloudflare-agent/src/commands.ts`
- Create: `examples/cloudflare-agent/src/commands.test.ts`
- Modify: `examples/cloudflare-agent/src/index.ts`
- Modify: `examples/cloudflare-agent/package.json`
- Create: `examples/cloudflare-agent/vitest.config.ts`

- [ ] **Step 1: Add vitest to the agent**

Run:
```bash
cd examples/cloudflare-agent && npm i -D vitest@^2
```
Create `examples/cloudflare-agent/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing dispatch test**

Create `examples/cloudflare-agent/src/commands.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dispatchCommand, SUPPORTED_COMMANDS } from "./commands";

describe("dispatchCommand", () => {
  it("supports the ask command", () => {
    expect(SUPPORTED_COMMANDS).toContain("ask");
  });
  it("ask uses the prompt input", async () => {
    const out = await dispatchCommand(
      "ask",
      { prompt: "hello" },
      { answer: async (q: string) => `echo:${q}` },
    );
    expect(out).toBe("echo:hello");
  });
  it("falls back to legacy `question` field for ask", async () => {
    const out = await dispatchCommand(
      "ask",
      { question: "legacy" },
      { answer: async (q: string) => `echo:${q}` },
    );
    expect(out).toBe("echo:legacy");
  });
  it("rejects an unknown command", async () => {
    await expect(
      dispatchCommand("nope", {}, { answer: async () => "" }),
    ).rejects.toThrow(/unknown command/i);
  });
  it("ask requires a prompt", async () => {
    await expect(
      dispatchCommand("ask", {}, { answer: async () => "" }),
    ).rejects.toThrow(/prompt/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd examples/cloudflare-agent && npx vitest run src/commands.test.ts`
Expected: FAIL — cannot find `./commands`.

- [ ] **Step 4: Implement the dispatcher**

Create `examples/cloudflare-agent/src/commands.ts`:
```ts
/**
 * Command dispatch for the Tai fulfillment contract. Maps a command id +
 * inputs to a text result. Kept pure (the answer fn is injected) so it is
 * unit-testable without the network or env.
 */
export const SUPPORTED_COMMANDS = ["ask"] as const;

export type Answerer = { answer: (prompt: string) => Promise<string> };

export async function dispatchCommand(
  command: string,
  inputs: Record<string, unknown>,
  deps: Answerer,
): Promise<string> {
  if (command === "ask") {
    const prompt = String(inputs.prompt ?? inputs.question ?? "").trim();
    if (!prompt) throw new Error("ask requires a `prompt`");
    return deps.answer(prompt);
  }
  throw new Error(`unknown command: ${command}`);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd examples/cloudflare-agent && npx vitest run src/commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire dispatch + health route into `index.ts`**

In `examples/cloudflare-agent/src/index.ts`:

(a) Add a `GET /health` (and `GET /`) JSON response for the pre-pay ping:
```ts
// inside the fetch handler's routing, for GET "/" or "/health":
if (request.method === "GET" && (path === "/" || path === "/health")) {
  return json({ ok: true, agent: env.AGENT_NAME, commands: SUPPORTED_COMMANDS });
}
```
(b) In the `POST /hire` handler, accept the new shape and keep back-compat. Replace the body-parse + answer step with:
```ts
// body may be {command, inputs, payment_tx_digest} (new) or
// {question, payment_tx_digest} (legacy).
const command = typeof body.command === "string" ? body.command : "ask";
const inputs =
  body.inputs && typeof body.inputs === "object"
    ? (body.inputs as Record<string, unknown>)
    : { question: body.question };
// ... after the existing payment verification + KV claim ...
const result = await dispatchCommand(command, inputs, {
  answer: (prompt) =>
    env.OPENAI_API_KEY ? answerWithOpenAI(prompt, env) : Promise.resolve(answerWithStub(prompt, env)),
});
return json({ ok: true, result, payment: { tx_digest: body.payment_tx_digest } });
```
Add the import at the top: `import { dispatchCommand, SUPPORTED_COMMANDS } from "./commands";`

(Keep the existing `verifyServicePayment` + `CONSUMED_TXS` claim-before-verify exactly as-is — only the parse and the answer-dispatch change. Ensure CORS headers allow the dashboard origin on both routes; if a `corsHeaders` helper exists, apply it, else add `access-control-allow-origin: *` to the `json()` responses and handle `OPTIONS`.)

- [ ] **Step 7: Typecheck**

Run: `cd examples/cloudflare-agent && npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add examples/cloudflare-agent
git commit -m "feat(cloudflare-agent): Tai fulfillment contract — command dispatch + health route"
```

- [ ] **Step 9: Deploy (manual, requires Cloudflare auth)**

Run: `cd examples/cloudflare-agent && npm run deploy`
Expected: Worker uploaded; `GET /health` returns `{ ok: true, ... }`. (If auth is unavailable in this environment, stop and tell the user this step is theirs.)

---

## Task 8: Docs page for the command/fulfillment spec

**Files:**
- Create: `app/src/app/(dashboard)/docs/commands/page.tsx`
- Modify: `app/src/components/docs/DocsSidebar.tsx`

- [ ] **Step 1: Write the doc page**

Create `app/src/app/(dashboard)/docs/commands/page.tsx` using the existing DocsKit components (`DocTitle`, `H2`, `P`, `C`, `Code`, `Note`, `DocFooterNav`). Cover: what a command is; the default set (`ask` sync, `commission` escrow); the manifest shape (`TaiCommand`, `fulfillmentUrl`, `disabledDefaults`); how to get custom commands listed (submit to the Tai registry today); the **fulfillment endpoint contract** (`GET /health` → `{ok,agent,commands}`; `POST {command, inputs, paymentTxDigest, coinType, launchpadAccountId}` → verify on-chain → `{ok, result}`); and the trust note (sync = pay-first + health-ping; escrow for big jobs). Mirror the prose style of `docs/hiring/page.tsx`.

```tsx
import { DocTitle, H2, P, C, Code, Note, DocFooterNav } from "@/components/docs/DocsKit";

export default function CommandsDoc() {
  return (
    <>
      <DocTitle
        kicker="documentation"
        title="Agent commands"
        lead="The services a payer can buy from an agent — Tai defaults plus whatever the dev adds."
      />
      <H2 id="what">What a command is</H2>
      <P>
        Each agent exposes a catalog of <strong>commands</strong> — named
        services with a price and inputs. Tai ships two defaults on every
        agent: <C>ask</C> (an instant question answered inline) and{" "}
        <C>commission</C> (a larger, escrow-backed job). Devs disable defaults
        or add their own.
      </P>
      <H2 id="fulfillment">Fulfillment modes</H2>
      <P>
        A command is <C>sync</C> or <C>escrow</C>. Sync: you pay, the dashboard
        relays your request to the agent&apos;s endpoint, the answer shows
        inline (paid up front, no escrow — best for small fast jobs). Escrow:
        funds lock in a work order and release on delivery (or refund after the
        deadline) — best for bigger jobs. Escrow needs a v1.1 agent.
      </P>
      <H2 id="endpoint">Fulfillment endpoint contract</H2>
      <P>For sync commands, an agent runtime implements:</P>
      <Code>{`GET  /health  -> { ok: true, agent, commands: string[] }

POST /         -> body: { command, inputs, paymentTxDigest,
                          coinType, launchpadAccountId }
                  the agent verifies the payment on-chain
                  (success; ServicePaymentEvent for this account;
                   amount >= price; fresh; digest not replayed),
                  then returns { ok: true, result } or
                  { ok: false, error }`}</Code>
      <Note kind="note">
        The reference implementation is the Cloudflare agent in{" "}
        <C>examples/cloudflare-agent</C>. To list custom commands for your
        agent today, submit a manifest to the Tai registry.
      </Note>
      <DocFooterNav prev={{ href: "/docs/hiring", label: "Hiring & escrow" }} />
    </>
  );
}
```

- [ ] **Step 2: Add the sidebar link**

In `app/src/components/docs/DocsSidebar.tsx`, add a link to `/docs/commands` (label "Agent commands") near the "Hiring & escrow" entry, matching the existing link markup.

- [ ] **Step 3: Build**

Run: `cd app && npm run build`
Expected: "✓ Compiled successfully"; route `/docs/commands` present.

- [ ] **Step 4: Commit**

```bash
git add "app/src/app/(dashboard)/docs/commands/page.tsx" app/src/components/docs/DocsSidebar.tsx
git commit -m "docs(app): agent commands + fulfillment endpoint spec"
```

---

## Task 9: Full verification + deploy

- [ ] **Step 1: Run all unit tests**

Run: `cd app && npm test` then `cd examples/cloudflare-agent && npm test`
Expected: all green.

- [ ] **Step 2: Build the app**

Run: `cd app && npm run build`
Expected: "✓ Compiled successfully".

- [ ] **Step 3: Deploy the app (manual)**

Run: `cd app && vercel --prod --yes`
Expected: READY.

- [ ] **Step 4: Manual wallet verification (user-owned)**

Document for the user to run (cannot be unit-tested):
- Larry (`/agent/0x8831…c36e`): the menu shows **ask** only (instant). Connect wallet → type a prompt → "pay & run" → payment confirms → answer renders inline. (Requires Larry's Worker redeployed from Task 7.)
- A v1.1 agent (Demo): the menu shows **ask** (if it has an endpoint) and **commission** (escrow). Run `commission` → a work order is created → track on the work-order page.

- [ ] **Step 5: Final commit (if any docs/notes changed)**

```bash
git add -A && git commit -m "chore: agent command catalog — verification notes"
```

---

## Self-Review

**Spec coverage:**
- Data model (TaiCommand/inputs/price/manifest) → Task 2. ✓
- Tai defaults `ask`+`commission` → Task 2 (`TAI_DEFAULT_COMMANDS`). ✓
- `effectiveCommands` (defaults − disabled + custom, capability filter) → Task 2 + tests. ✓
- Tai-curated registry + Larry endpoint → Task 3. ✓
- Dashboard menu + per-command runner; sync relay (+ health ping) and escrow spec → Tasks 4–6. ✓
- Fulfillment contract + reference impl + health route → Task 7. ✓
- Trust model (pay-first sync, health ping, escrow for big jobs) → CommandRunner copy + docs Task 8. ✓
- Gating (sync needs endpoint, escrow needs v1.1) → `effectiveCommands` + tests. ✓
- Error handling (offline ping blocks pay; post-pay fulfillment failure shows digest; input maxLen; empty catalog note) → Task 4 + Task 5. ✓
- Docs → Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 6 Step 2 references "the Panel titled hire this agent" — that string exists in the current file (verified during design). Task 7 Step 6 describes edits against the existing `index.ts` routing/verification, which the implementer will see in-file; the new code (dispatch, health, parse) is shown in full.

**Type consistency:** `effectiveCommands`/`resolvePriceMist`/`serializeEscrowSpec`/`TaiCommand`/`AgentManifest`/`MIN_PRICE_MIST`/`MAX_SPEC_URL_LEN` names match across Tasks 2, 4, 5. `manifestFor` (Task 3) returns `{fulfillmentUrl, commands, disabledDefaults}` consumed in Task 6. `dispatchCommand`/`SUPPORTED_COMMANDS`/`Answerer` match across Task 7 steps. `record_service_payment_sui`(config, account, coin, clock) and `create_work_order`(account, coin, specHash, specUrl, deadline, disputeWindow, clock) argument orders match the deployed contract and the existing DirectPayForm/HireForm.
