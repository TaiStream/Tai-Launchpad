# Sovereign-mode reference agent

The sibling of [Larry](../cloudflare-agent/) — same Cloudflare Worker shape,
opposite custody model. Where Larry is **commissioned mode** (Worker holds
no keys; the hirer signs every on-chain payment themselves), this agent is
**sovereign mode**: the agent owns its own keys, holds its own OwnerCap +
OperatorCap on Tai, and signs every on-chain action from inside the runtime.

The runtime is designed for **TEE deployment** — Phala Cloud, Mysten
Nautilus, AWS Nitro, Intel TDX. In this demo it runs as a Cloudflare Worker
with the keypair sealed in a Worker Secret. The architecture transfers
unchanged; only the secret-storage mechanism upgrades.

## What's different from Larry

| Aspect | Larry (commissioned) | This (sovereign) |
|---|---|---|
| Who holds the keys | hirer | the agent itself |
| Who signs on chain | hirer | the agent (inside the runtime) |
| OwnerCap holder | publisher | agent's own address |
| OperatorCap holder | (n/a — direct payments only) | agent's own address |
| Outbound payments | not supported | `operator_spend_sui` from own treasury |
| Escrow hires | not supported | `accept_work_order_with_operator` + `submit_receipt_with_operator` |
| Production secret store | Worker Secret | TEE sealed storage (production) |

## Routes

| Method | Path | What |
|---|---|---|
| GET | `/` | HTML splash — identity + on-chain ids + hire flow |
| GET | `/info` | JSON public info |
| GET | `/health` | liveness probe |
| GET | `/attestation` | TEE attestation report (stub today; real quote in Phala mode) |
| POST | `/hire` | direct hire — verify external payment, return answer |
| POST | `/work/accept` | acknowledge a `WorkOrder<T>` escrow with the agent's OperatorCap |
| POST | `/work/submit` | submit a receipt against an open work order |

## Launch ceremony (one-time, before first deploy)

The agent needs an on-chain identity before the runtime is useful. The
ceremony has four steps. Each is a single command.

### 1. Generate the agent's keypair

```bash
python3 - <<'PY'
import secrets
seed = secrets.token_hex(32)
print("seed_hex:", seed)
# Address derivation: blake2b_256([0x00] || ed25519_pubkey(seed))[:32]
# Use the sovereign-agent runtime's address derivation, or any Sui SDK.
PY
```

Keep the printed `seed_hex` private. You will hand it to the Worker as a
secret in step 4. In a real TEE deployment you skip this step entirely —
the enclave generates and seals the key on its first boot.

### 2. Launch a coin on Tai with the agent's address as **both** OwnerCap and OperatorCap recipient

This is what makes it "sovereign mode" — owner_cap_recipient and
operator_recipient are the same address (the agent's), so the agent has
both full custody and scoped daily-ops authority over itself.

```bash
# From a funded wallet (typically the project publisher's address, which
# has gas to spare), publish a fresh OTW coin module for this agent and
# call launch_agent_coin in one PTB.

# Easiest: use the shipped templater — `tai launch` generates + publishes the
# coin module and chains launch_agent_coin in one command. Point the caps at
# the agent's own address for sovereign mode.
#
# Manual alternative: copy examples/test-agent/sources/ to a fresh directory,
# rename the module + OTW witness, publish it, then call launch_agent_coin via
# `sui client ptb` with the agent's address as both --owner-cap-recipient and
# --operator-cap-recipient.
```

The launch emits a `LaunchEvent` carrying:

- `launchpad_id`           → `LAUNCHPAD_ACCOUNT_ID`
- `agent_treasury_id`      → `AGENT_TREASURY_ID`
- `owner_cap_id`           → goes to the agent's address
- `treasury_cap_holder_id` → bookkeeping only

The OperatorCap is transferred to the agent's address in the same tx; query
the recipient's owned objects to find its id (filter on
`OperatorCap<T>`).

### 3. Paste the resulting ids into `wrangler.toml`

```toml
[vars]
LAUNCHPAD_ACCOUNT_ID = "0x..."   # from LaunchEvent.launchpad_id
AGENT_TREASURY_ID    = "0x..."   # from LaunchEvent.agent_treasury_id
OPERATOR_CAP_ID      = "0x..."   # OperatorCap<T> owned by the agent's address
COIN_TYPE            = "0x...::my_agent::MY_AGENT"
```

### 4. Push the seed as a Worker Secret + deploy

```bash
wrangler kv:namespace create CONSUMED_TXS_SOVEREIGN
# → paste the id into wrangler.toml under [[kv_namespaces]]

wrangler secret put AGENT_PRIVATE_KEY_HEX
# → paste the seed_hex from step 1 when prompted

wrangler deploy
```

After deployment, `GET /info` should return the agent's address and
on-chain ids. Verify the address matches what step 1 produced.

## Why this matters

Tai's v1 spec promises three operational modes (commissioned, sovereign,
spawned) emerge from the **same Move primitives** — distinguished only by
who holds the OwnerCap and OperatorCap. Larry demonstrates commissioned
mode. This demonstrates sovereign mode. The Move package didn't change
between the two; only the cap distribution at launch + the runtime's
signing posture.

That's the load-bearing claim of the v1 architecture: you can compose any
custody model out of the same primitives. No special "sovereign" Move
function. No special "commissioned" event. Just different cap recipients
at launch and different signers at runtime.

## TEE upgrade path

The `/attestation` route returns a stub today with a clear demo-mode warning.
For a real production deployment:

1. Build the Worker bundle as a single JS artifact + assets manifest.
2. Wrap it in a Phala Cloud TDX-attested container (or AWS Nitro, or
   Intel TDX bare-metal).
3. Generate the keypair *inside* the enclave on first boot. Seal it
   against the enclave identity. Never expose it.
4. Replace the stub `/attestation` body with a real RA-TLS quote — the
   enclave's signed statement that "code hash X is running, and the
   key inside me is bound to me."
5. Update remote verifiers (other agents, the dashboard, the hiring
   portal) to validate the quote before trusting messages signed by this
   agent.

The runtime code you're looking at doesn't change. Only the deployment
target, the secret-storage primitive, and the attestation payload do.

## Local dev

```bash
npm install
wrangler dev    # http://localhost:8787
```

Configure `.dev.vars` with the same fields as `wrangler.toml` overrides for
local-only secrets (`AGENT_PRIVATE_KEY_HEX`, optionally `OPENAI_API_KEY`).
