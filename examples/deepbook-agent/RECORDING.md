# Demo recording guide — Autonomous Agent Wallet (Tai × DeepBook)

Sui Overflow 2026 · Agentic Web · Sub-track 2. Target length: **2–3 minutes**.
The goal is to show, on real testnet, that an AI agent can trade on DeepBook
under authority that is **capped, scoped, expiring, and instantly revocable —
enforced in Move**, not by the agent behaving.

## Before you hit record (one dry run)

```bash
cd examples/deepbook-agent
npm install
export OPERATOR_KEY=suiprivkey1…          # funded testnet key, >= 4 SUI
./demo.sh check                            # no-spend preflight — confirms balance + binaries
./demo.sh                                  # do ONE full run now, un-recorded, to warm caches
```

Each on-chain step prints a Suiscan link. Open a couple in a browser tab so you
can cut to them. Then re-run for the take. (Testnet indexing can lag a second on
the launch step; a warm run avoids an awkward pause on camera.)

Terminal: large font, dark theme, wide enough that the `━━ beat ━━` headers don't
wrap. Nothing else on screen.

## The take — `demo.sh` (the core story, ~2 min)

Run `./demo.sh` and narrate over the four beats it prints:

1. **"An agent launches."** — beat 1. It gets its own treasury and a sovereign
   OwnerCap. *"This is the agent's wallet — on-chain, it owns its own funds."*
2. **"The owner grants a budget — but a bounded one."** — beat 2. Point at the
   line `OperatorCap (cap: 1 SUI/day, 24h TTL, revocable — all enforced in Move)`.
   *"This isn't an API key. It's a Move object: a daily ceiling, an expiry, an
   allowlist, revocable in one transaction. The chain enforces it, not the agent."*
3. **"The agent trades — autonomously, in one atomic transaction."** — beat 3.
   *"In a single PTB: the agent spends under its cap — Move checks the ceiling —
   deposits to its DeepBook BalanceManager, and places a real DeepBook order."*
   Cut to the Suiscan link: show the `TreasuryWithdrawEvent` → `BalanceEvent` →
   **`OrderPlaced`** in one tx. *"That's a real order on a real DeepBook pool."*
4. **"The owner revokes — and the agent is cut off, on-chain, instantly."** —
   beat 4. *"Same agent, same code, tries to trade again. The transaction reverts
   with `EOperatorCapRevoked`. Compromise the agent and you rotate one cap; the
   treasury was never at risk."*

Close on the final green line and the dashboard URL.

## Optional escalation — `swarm.sh` (+30–45s, if you want the "it scales" beat)

*"And it isn't one agent."* Run `./swarm.sh`: one treasury, **N independently
capped** sub-agents each providing liquidity, then the owner **revokes one** and
the rest keep running — `active operator caps now: 2`. *"Governed, risk-
distributed, revocable autonomous liquidity — the blast radius of any one agent
is bounded in Move."*

## The one honesty line — say it, don't skip it

> *"We're showing a real, capped, revocable DeepBook order — the **mechanism**.
> We're not claiming a yield number: maker income needs real flow, and a synthetic
> testnet book doesn't have it. The primitive is the product; the yield is the
> roadmap."*

Judges trust a demo that names its own limits far more than one that overclaims.

## If asked "why Sui / why DeepBook"

- **Sui:** the spending policy is a *type-enforced Move object*, composed
  atomically with the trade in one PTB — you can't get this "the ceiling is the
  chain's job, not the agent's" guarantee from an off-chain key vault.
- **DeepBook:** it's the venue that makes the wallet economically alive — the
  agent isn't just holding funds, it's acting in a real on-chain market under
  bounded authority.

## Submission checklist

- [ ] Video (2–3 min) recorded from a warm run, Suiscan cuts included
- [ ] The honesty line is in the video
- [ ] Repo link + this README in the Devfolio submission
- [ ] Tx digests from your run pasted into the submission (fresh proof, not the old ones)
