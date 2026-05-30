# Agent Command Catalog — Design

Date: 2026-05-30
Status: approved (design); pending implementation plan

## Problem

Today "hiring" an agent is just "send SUI" — there is no notion of *what*
service is being bought. A payer sees a blank amount field, not a menu of
things the agent does. We need a way for an agent developer to declare the
services (commands) a payer can invoke, with a Tai-provided default set that
devs can disable or extend.

## Goals

- A per-agent **command catalog** the dashboard renders as a menu (label,
  description, price, fulfillment mode).
- Tai ships **built-in default commands**; devs add custom ones and may
  disable defaults.
- A payer can pick a command, fill its inputs, pay, and receive a result.
- Works for the live agents: Larry (v1.0.1, direct-pay only) and v1.1 agents
  (direct-pay + escrow).
- **No smart-contract change.** Reuse `record_service_payment_sui` (direct)
  and `work_order::create_work_order` (escrow), both already deployed.

## Non-goals (YAGNI)

- No on-chain command registry / on-chain price enforcement.
- No `promote`/`tip` in the default set (`promote` can be a dev-added custom
  command; `tip` dropped).
- No dynamic pricing beyond `fixed | hire_price | min`.
- No multi-step / stateful commands; no scheduling.

## Architecture decisions (from brainstorming)

1. **Catalog model:** off-chain manifest + convention. Tai standardizes the
   manifest format; trust comes from cred + escrow dispute, not on-chain
   enforcement.
2. **Discovery:** Tai-curated registry (bundled app data), keyed by launchpad
   account id. No network fetch, no on-chain pointer.
3. **Fulfillment:** both modes, declared per command — `sync` (relay to the
   agent's endpoint, instant inline result) and `escrow` (work order +
   on-chain receipt, for larger/async jobs).
4. **Default set:** `ask` (sync) + `commission` (escrow).
5. **Sync trust:** accept pay-first for small sync commands (reputation/cred
   is the protection), AND ping the agent's endpoint before taking payment so
   a payer never pays an offline agent. Larger jobs use escrow.

## Data model

```ts
type FulfillmentMode = "sync" | "escrow";

type CommandInput = {
  key: string;                  // "prompt"
  label: string;                // "Your question"
  type: "text" | "textarea" | "url";
  required: boolean;
  placeholder?: string;
  maxLen?: number;              // enforced client-side; escrow spec_url <= 512
};

type CommandPrice =
  | { mode: "fixed"; sui: string }   // a set price
  | { mode: "hire_price" }           // the agent's current NAV x cred
  | { mode: "min" };                 // a small floor (e.g. 0.1 SUI)

type TaiCommand = {
  id: string;                   // stable slug: "ask", "commission", "audit"
  label: string;
  description: string;
  fulfillment: FulfillmentMode;
  price: CommandPrice;
  inputs: CommandInput[];
};

type AgentCommandManifest = {
  launchpadAccountId: string;
  fulfillmentUrl?: string;      // required for any sync command to appear
  commands?: TaiCommand[];      // custom commands (merged over defaults)
  disabledDefaults?: string[];  // default ids the dev opted out of
};
```

### Tai default commands (built-in)

- `ask` — fulfillment `sync`, price `hire_price` (editable down to a min),
  inputs: `prompt` (textarea, required, maxLen ~1000). Shown only if the agent
  has a `fulfillmentUrl`.
- `commission` — fulfillment `escrow`, price `hire_price` (editable), inputs:
  `spec` (textarea, required) + `deliverable_url` (url, optional). Shown only
  on v1.1 agents (escrow is v1.1+).

### Effective catalog resolver

`effectiveCommands(agent)` = (Tai defaults − `disabledDefaults`) + custom
`commands`, then filtered by capability:

- drop `sync` commands if the agent has no `fulfillmentUrl`;
- drop `escrow` commands if the agent is not v1.1.

So Larry (v1.0.1, has a fulfillmentUrl) → `ask`. A v1.1 agent with an endpoint
→ `ask` + `commission`. A v1.1 agent with no endpoint → `commission` only.

## Storage / registry

- `app/src/lib/commands.ts` — manifest types, Tai default commands, and
  `effectiveCommands(agent)`.
- Per-agent custom manifests live in the Tai-curated registry alongside
  `known-agents.ts` (e.g. `app/src/lib/agent-commands.ts`), keyed by launchpad
  account id, each optionally carrying `fulfillmentUrl`, `commands`,
  `disabledDefaults`. Larry's entry sets `fulfillmentUrl` to his Worker.
- Bundled app data → always available, no fetch failure path.

## Dashboard flow

The agent page's single hire/pay card is replaced by a **command menu**
(`CommandMenu`): one row per effective command (label · description · price ·
"instant"/"escrow" badge). Selecting a command expands `CommandRunner`:

1. Render the command's declared inputs.
2. Resolve the price (`fixed` → as given; `hire_price` → current NAV×cred,
   editable; `min` → floor), via the existing locale-tolerant decimal input.
3. On submit, branch by fulfillment mode:
   - **sync:** (c) ping `fulfillmentUrl` health first; then build a direct
     `record_service_payment_sui<T>(config, account, payment, clock)` on the
     **agent's own package + config** (per lineage), sign via wallet, await
     confirm, then `POST {command, inputs, paymentTxDigest, coinType,
     launchpadAccountId}` to `fulfillmentUrl`; render the returned result
     inline + a Suiscan link.
   - **escrow:** serialize `{commandId, inputs}` into the work-order
     `spec_url` (and a content hash into `spec_hash`), build
     `work_order::create_work_order` (v1.1), sign, link to the work-order page
     where accept → receipt → release proceeds.

Reuses the payment plumbing already built in `DirectPayForm` (sync) and
`HireForm` (escrow); those get refactored into / consumed by `CommandRunner`.

## Tai ↔ agent fulfillment contract (sync)

Published spec + reference implementation. The agent's `fulfillmentUrl`:

- `GET` (health): returns `{ ok: true, agent, commands?: string[] }` for the
  pre-pay ping.
- `POST { command, inputs, paymentTxDigest, coinType, launchpadAccountId }`:
  the agent **verifies the payment on-chain** (successful tx; a
  `ServicePaymentEvent` for this `launchpadAccountId`; amount ≥ the command's
  price; fresh; digest not already consumed — claim-before-verify like Larry),
  fulfills, and returns `{ ok: true, result }` (markdown/text) or
  `{ ok: false, error }`. CORS must allow the dashboard origin.

Larry's existing `/hire` is generalized to this shape (accept a `command` +
structured `inputs` rather than only `question`). Documented so any dev can
implement; Tai ships the reference (cloudflare-agent).

## Trust model

- **No on-chain fulfillment enforcement.** Trust = the agent's cred (real paid
  revenue raises its hire price and is publicly on-chain) + the inline result
  + escrow's dispute window for larger jobs.
- **sync is pay-first.** Mitigations: (a) reputation/cred + keep sync for
  low-value, fast commands; (c) pre-pay health ping so an offline agent can't
  be paid. UI labels sync clearly: "instant · paid up front · no escrow."
- **escrow (`commission`)** is the protected path for anything substantial.

## Components (isolation)

- `lib/commands.ts` — types, Tai defaults, `effectiveCommands`, price resolve,
  spec (de)serialization for escrow.
- `lib/agent-commands.ts` — Tai-curated per-agent manifests (registry).
- `components/CommandMenu.tsx` — lists effective commands, handles selection.
- `components/CommandRunner.tsx` — inputs form + price + pay + fulfill
  (sync relay / escrow), reusing DirectPayForm/HireForm logic.
- `examples/cloudflare-agent` — generalize `/hire` to the fulfillment contract;
  add the `GET` health route.
- `app/.../docs` — a "Agent commands" doc page (manifest format, fulfillment
  endpoint spec, default set, how to add a command).

## Data flow

open agent page → `effectiveCommands(agent)` (defaults + registry, filtered by
capability) → payer selects a command, fills inputs → price resolved → submit:
sync → health ping → sign direct payment → POST to fulfillmentUrl → inline
result; escrow → sign work order → work-order page.

## Error handling

- No `fulfillmentUrl` → sync commands hidden (can't fulfill). Pre-v1.1 agent →
  escrow commands hidden. (If an agent ends up with zero effective commands,
  show a "no purchasable commands configured" note + CLI fallback.)
- Health ping fails (sync) → block payment, show "agent appears offline, try
  later" — never take money for a dead endpoint.
- Fulfillment POST fails after a confirmed payment → show the error AND the
  payment digest (payer has on-chain proof; can retry the POST or dispute via
  the agent's channel). Surfaced honestly because sync is pay-first.
- Input validation: required + maxLen client-side; escrow `spec_url` capped at
  512 / `spec_hash` at 128 (matches the contract bounds).
- Wrong wallet network → existing NetworkBanner.

## Test plan

- Unit: `effectiveCommands` (defaults merge, disabledDefaults, capability
  filtering for sync-no-endpoint and escrow-non-v1.1); price resolver; escrow
  spec (de)serialization round-trip + length caps.
- cloudflare-agent: payment-verification + command dispatch unit tests (extend
  existing).
- Manual (wallet): `ask` on Larry (sync, direct pay → inline result);
  `commission` on a v1.1 agent (escrow → work order → receipt → release).

## Out of scope for this spec / future

- On-chain command registry + price enforcement.
- Self-serve dev manifest (agent-served `/.well-known/tai-commands` or on-chain
  pointer) — deferred; Tai-curated registry first.
- `promote`/`tip` defaults; subscriptions; multi-step commands.
