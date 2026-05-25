# Larry the Analyst — Cloudflare Worker runtime

Reference implementation of a Tai-launched AI agent hosted on Cloudflare Workers.

This Worker is the smallest meaningful "agent runtime" we could ship — under 350 lines of TypeScript, no private keys held server-side, no on-chain transactions sent by the Worker itself. The hirer pays Tai directly from their own wallet; the Worker verifies the payment on-chain and responds.

It's the simplest deployment shape for an agent that wants the Tai economic primitives without operating a TEE or trusted compute.

---

## Architecture

```
                                  ┌─────────────────────────────────────────────┐
   1. Hirer submits a PTB         │  Sui testnet                                │
   ────────────────────────────▶  │                                             │
                                  │  tai::launchpad::record_service_payment_sui │
                                  │  on Larry's LaunchpadAccount                │
                                  │                                             │
                                  │  → 40% NAV / 50% creator / 10% platform     │
                                  │  → lifetime_service_revenue_sui++           │
                                  │  → ServicePaymentEvent emitted              │
                                  └──────────────┬──────────────────────────────┘
                                                 │
   2. Hirer POSTs the tx digest                  │
   ────────────────────────────▶  ┌──────────────┴──────────────────────────────┐
                                  │  Cloudflare Worker (this code)              │
                                  │                                             │
                                  │  - sui_getTransactionBlock(tx, events+fx)   │
                                  │  - assert effects.status == success         │
                                  │  - assert event.launchpad_id == ours        │
                                  │  - assert sui_amount >= MIN_PAYMENT_MIST    │
                                  │  - assert counted_toward_cred == true       │
                                  │  - assert tx fresh (< 10 min)               │
                                  │  - assert tx not in KV (anti-replay)        │
                                  │  - call OpenAI (or stub) for the response   │
                                  │  - store tx digest in KV for 7 days         │
                                  │  - return JSON                              │
                                  └─────────────────────────────────────────────┘
```

Why the **hirer** does the on-chain write, not the Worker:

- The Worker would otherwise need a private key, and key custody on Cloudflare Workers (without TEE attestation) is mid-trust. By keeping all signing in the hirer's wallet, the Worker is a pure verifier — it can be compromised and the worst case is "no payment is required" (zero earnings), never "drained treasury."
- For agents that DO need to spend (call `operator_spend_sui`, etc.), the right pattern is to give the Worker an OperatorCap (NOT an OwnerCap) with a tight daily limit and allowlist. Then a key compromise costs at most one day of spend within the allowlist. That's a separate variant of this example, not included here.

---

## Setup

```sh
cd examples/cloudflare-agent
npm install

# Create the KV namespace for storing consumed tx digests
npx wrangler kv:namespace create CONSUMED_TXS

# Copy the id wrangler prints into wrangler.toml's [[kv_namespaces]] id field

# (Optional) For real LLM responses:
npx wrangler secret put OPENAI_API_KEY
```

---

## Local dev

```sh
npm run dev
```

Open <http://localhost:8787/> for the splash page; hit `/info` for config; POST `/hire` to invoke the agent. Local dev uses Cloudflare's KV preview namespace; the on-chain checks still hit live testnet.

---

## Deploy

```sh
npm run deploy
```

`wrangler` deploys to your Cloudflare account at `https://larry-the-analyst.<your-subdomain>.workers.dev`. Update `name` in `wrangler.toml` if you want a different worker URL.

---

## Hire flow

End-to-end demo:

### 1. Build the payment PTB

The hirer (any Sui wallet) constructs:

```ts
import { Transaction } from "@mysten/sui/transactions";

const tx = new Transaction();
tx.moveCall({
    target: `${TAI_PACKAGE_ID}::launchpad::record_service_payment_sui`,
    typeArguments: [LARRY_COIN_TYPE],
    arguments: [
        tx.object(LAUNCHPAD_CONFIG_ID),
        tx.object(LARRY_LAUNCHPAD_ACCOUNT_ID),
        tx.splitCoins(tx.gas, [tx.pure.u64(100_000_000)]),  // 0.1 SUI
        tx.object("0x6"),
    ],
});
const result = await client.signAndExecuteTransaction({ transaction: tx, signer });
const paymentDigest = result.digest;
```

For the live Larry deployment, the ID constants are:

```
TAI_PACKAGE_ID            0xb41fa8ee7b2d902e706f197ec7e90484e4ded4347c6666d08eff09820e266909
LAUNCHPAD_CONFIG_ID       0xe2ec37d9edf190d94835a6163cdd079ca296196475dd4969a890396b94daa1f0
LARRY_LAUNCHPAD_ACCOUNT   0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e
LARRY_COIN_TYPE           0x14880acc61795bb38718104fb74e79613706023028645483dd042fbf311e4cf2::larry::LARRY
```

### 2. Call the Worker

```sh
curl -X POST https://larry-the-analyst.<subdomain>.workers.dev/hire \
  -H "content-type: application/json" \
  -d '{
    "question": "What should I watch for in this trade?",
    "payment_tx_digest": "<digest from step 1>"
  }'
```

### 3. Response

```json
{
  "agent": "Larry the Analyst",
  "question": "...",
  "answer": "...",
  "payment": {
    "tx_digest": "...",
    "payer": "0x...",
    "sui_amount_mist": 100000000,
    "counted_toward_cred": true,
    "new_lifetime_revenue_sui_mist": 100000000
  },
  "disclaimer": "..."
}
```

Each successful `/hire` grows Larry's `nav_sui` by 40% of the payment (40 MIST out of every 100), nudges his cred multiplier toward 2.0x via the SUI denominated revenue, and emits a `TreasuryWithdrawEvent` (creator share) + `FeeDistributedEvent`.

---

## Errors

| HTTP status | Meaning |
|---|---|
| 400 | Bad request body (missing / malformed `question` or `payment_tx_digest`). |
| 402 | `payment_tx_digest` doesn't reference a valid `ServicePaymentEvent` for this agent. Reasons surfaced in `error` + `detail`. |
| 409 | `payment_tx_digest` already consumed. Each payment receipt is single-use. |
| 500 | Internal error (RPC / LLM / runtime). |

---

## What this is NOT

- **Not a key-holding signer.** The Worker doesn't sign anything. If you want Larry to also *spend* SUI (e.g. tip third parties), give the Worker an OperatorCap and add Web Crypto Ed25519 signing — that's a separate variant.
- **Not TEE-attested.** Cloudflare Workers run in V8 isolates, not in a TEE. Cloudflare staff can in principle observe the Worker's runtime. For agents handling sensitive inputs, deploy to Phala Cloud + Nautilus instead.
- **Not on mainnet.** All on-chain IDs point at Sui testnet.

---

## Related

- [`tai-core`](../../rust/tai-core) — the Rust library this TS code mirrors.
- [`SPEC.md §5.4`](../../SPEC.md#54-service-payments) — on-chain semantics of `record_service_payment_sui`.
- [`MASCOT.md`](../../docs/MASCOT.md) — the visual identity Larry inherits.
