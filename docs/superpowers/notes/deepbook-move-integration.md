# DeepBook v3 Move integration — spike findings (MM vault Task 0)

## 0.1 — TradeCap cannot withdraw — VERIFIED (GO)

Source: `MystenLabs/deepbookv3` `packages/deepbook/sources/balance_manager.move`.

- `withdraw<T>` and `withdraw_all<T>` both call `generate_proof_as_owner(balance_manager, ctx)`, which runs `validate_owner(ctx)` → asserts `ctx.sender() == balance_manager.owner()`. **Withdrawal is owner-only.**
- `mint_trade_cap` mints a `TradeCap` validated by `validate_trader` (membership in the `allow_listed` set). A TradeCap authorizes **trading only** (`generate_proof_as_trader`); it is never accepted by `withdraw`/`withdraw_all`.
- Bottom line: **a TradeCap holder cannot withdraw.** The vault-owns-BalanceManager + manager-holds-trade-only-TradeCap design is sound: the manager physically cannot move the pool out.

Caveat (unchanged from the spec): a TradeCap *can* trade, so a malicious manager can still bleed value via adversarial fills (sell cheap to a wallet it controls). This is why orders must be **mediated + price-band-checked** by the vault (the manager never holds the raw TradeCap; it calls `vault::manager_place_order`). The withdrawal-block + price-band + rate-cap + revocation together bound the risk; nothing alone makes it rug-proof.

## Still open (gate the integration tasks)

- **0.2** — confirm Tai's Move package can depend on `deepbookv3` and build against the testnet deployment the SDK uses (`0xcbf4748a…07f7e`). Record the `Move.toml` dep stanza + published-at.
- **0.3** — map exact signatures: `mint_trade_cap`, `generate_proof_as_owner`, `deposit`, `withdraw`, `place_limit_order`, `cancel_order`, open-orders query (for the unwound assertion at strike).
- **0.4** — order-band **reference price** decision: DeepBook pool mid (manipulable on a thin book), Pyth on Sui (dependency + trust), or a reference pool. Needed before Task 4 (`manager_place_order`). Leaning: Pyth for robustness, with a sanity-vs-pool-mid cross-check; TBD.
