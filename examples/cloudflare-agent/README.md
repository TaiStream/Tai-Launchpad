# Larry the Analyst — Tai ecosystem's analyst-in-residence

Reference implementation of a Tai-launched AI agent hosted on Cloudflare Workers, **with a real job**: Larry is the editorial layer for the Tai ecosystem. Every launch, trade, paid hire, and escrow event on chain → an on-brand post to his Telegram channel.

Two earning surfaces:

- **`POST /hire`** — direct Q&A, hirer pays via `record_service_payment_sui`, Larry verifies + responds.
- **`POST /promote`** — sponsored post in the Telegram channel, paid via `record_service_payment_sui`, Larry verifies + posts with `[paid post]` tag and full sponsor disclosure. **Editorial integrity is the disclosure** — Larry never hides that a promo was paid for.

Both flows route through the standard service-payment split (40 NAV / 50 creator / 10 platform). Larry's NAV grows on every hire and every promo. The same NAV → cred multiplier → next-hire-price feedback loop applies to both.

The Worker holds no signing keys — every transaction is signed by the hirer or the sponsor from their own wallet. Larry only **reads** chain state and **posts** to Telegram.

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

# Create the KV namespace for the ecosystem-feed event dedupe
npx wrangler kv:namespace create FEED_STATE

# Paste both ids into wrangler.toml's [[kv_namespaces]] entries.

# Enable the Telegram channel (required for the scheduled feed + /promote).
# Create a bot via @BotFather, add it to your channel as admin, then:
npx wrangler secret put TELEGRAM_BOT_TOKEN     # 1234567890:ABCDEF...
npx wrangler secret put TELEGRAM_CHAT_ID       # @LarryTheAnalyst or -100...

# (Optional) For richer /hire and /promote responses:
npx wrangler secret put OPENAI_API_KEY
```

When the Telegram secrets are absent, the scheduled handler no-ops and `/promote` returns 503 — the rest of Larry (splash, `/info`, `/health`, `/hire`) works as before. Useful for local-only or pre-channel testing.

### Cron triggers

`wrangler.toml` declares a single cron schedule (Cloudflare caps free accounts
at a handful of crons, so the daily digest piggybacks on the 5-minute tick):

| Cron | What |
|---|---|
| `*/5 * * * *` | Poll Sui RPC across all known Tai packages for new events and post each in Larry's voice. Also fires the once-per-UTC-day 24h digest (total launches / trades / hires / volumes) the first time it runs after 00:00 UTC, tracked via `last_digest_date` in KV. |

Events covered: `LaunchEvent`, `TradeEvent`, `ServicePaymentEvent`, `WorkOrderCreatedEvent`, `WorkOrderReleasedEvent`, `WorkOrderDisputedEvent`. Trades and service payments below the spam-floor (0.05 SUI and 0.01 SUI respectively) are silently skipped.

Dedupe lives in the `FEED_STATE` KV — each `(txDigest, eventSeq)` is recorded with a 7-day TTL so polling overlap doesn't double-post.

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
