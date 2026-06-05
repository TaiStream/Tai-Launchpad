/**
 * Autonomous Agent Wallet — Tai OperatorCap × DeepBook.
 *
 * Demonstrates an AI agent autonomously trading on DeepBook under a budget
 * that is capped, scoped, expiring, and instantly revocable — ALL enforced in
 * Move by its Tai `OperatorCap`. This is the Agentic Web Sub-track 2 flow.
 *
 * In ONE atomic PTB:
 *   1. tai::agent_treasury::operator_spend_sui_coin  → Coin<SUI>   (budget gate)
 *   2. deepbook::balance_manager::deposit            (fund the manager)
 *   3. DeepBook placeLimitOrder                      (the real order)
 *
 * The spend (step 1) is gated by the OperatorCap: daily ceiling, expiry, and
 * the active/revoked check are all enforced on-chain. If the owner has revoked
 * the cap (see `revoke` mode), step 1 aborts and the whole PTB reverts — the
 * agent cannot trade. That is the safety guarantee, enforced by Move rather
 * than by the agent behaving.
 *
 * STATUS: the Tai side (operator_spend_sui_coin) is unit-tested in the Move
 * package. The DeepBook composition below is a reference to validate on a
 * testnet dry-run — confirm the pool key, coin keys, BalanceManager handling,
 * and the deposit moveCall signature against your installed @mysten/deepbook-v3
 * version. Spots needing confirmation are marked `CONFIRM:`.
 */

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { DeepBookClient } from "@mysten/deepbook-v3";

const SUI_CLOCK = "0x6";
const SUI_TYPE = "0x2::sui::SUI";

interface Config {
  /** Tai package id (call target — the upgraded id, e.g. 0xc5d0…). */
  taiPackageId: string;
  /** The agent's coin type `T` (e.g. 0x…::my_agent::MY_AGENT). */
  coinType: string;
  /** The agent's AgentTreasury<T> object id (shared). */
  agentTreasuryId: string;
  /** The OperatorCap<T> object id the agent runtime holds. */
  operatorCapId: string;
  /** Per-run budget to draw, in MIST. Must be <= the cap's daily_limit_sui. */
  budgetMist: bigint;
  /** DeepBook pool to trade, by SDK key. CONFIRM: a real testnet pool. */
  poolKey: string;
  /** BalanceManager SDK key + on-chain id (created once via `setup`). */
  balanceManagerKey: string;
  balanceManagerId: string;
  /** DeepBook package id (deposit moveCall target). CONFIRM: testnet id. */
  deepbookPackageId: string;
  /** Resting limit order. price/quantity per the pool's quote/base. */
  orderPrice: number;
  orderQuantity: number;
  isBid: boolean;
  rpcUrl: string;
}

function loadConfig(): Config {
  const env = process.env;
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  return {
    taiPackageId: need("TAI_PACKAGE_ID"),
    coinType: need("AGENT_COIN_TYPE"),
    agentTreasuryId: need("AGENT_TREASURY_ID"),
    operatorCapId: need("OPERATOR_CAP_ID"),
    budgetMist: BigInt(env.BUDGET_MIST ?? "1000000000"), // 1 SUI default
    // SUI_DBUSDC = base SUI / quote DBUSDC. The agent funds with SUI (from the
    // capped spend), so the natural order is an ASK (sell SUI for DBUSDC).
    poolKey: env.DEEPBOOK_POOL_KEY ?? "SUI_DBUSDC",
    balanceManagerKey: env.BALANCE_MANAGER_KEY ?? "AGENT_MANAGER",
    balanceManagerId: env.BALANCE_MANAGER_ID ?? "",
    // Defaults to the DeepBook v3 TESTNET package. The SDK auto-loads pools +
    // coin types for env:"testnet"; this id is only needed for the lower-level
    // balance_manager::deposit moveCall that consumes the Tai-spent coin.
    deepbookPackageId:
      env.DEEPBOOK_PACKAGE_ID ??
      "0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c",
    orderPrice: Number(env.ORDER_PRICE ?? "1"),
    orderQuantity: Number(env.ORDER_QUANTITY ?? "1"),
    isBid: (env.ORDER_SIDE ?? "ask") === "bid",
    rpcUrl: env.SUI_RPC_URL ?? getFullnodeUrl("testnet"),
  };
}

function operatorKeypair(): Ed25519Keypair {
  // 32-byte Ed25519 seed in hex (the agent runtime's operator key). In a real
  // deployment this lives in a TEE / sealed secret, never in plaintext env.
  const hex = process.env.OPERATOR_PRIVATE_KEY_HEX;
  if (!hex) throw new Error("missing env OPERATOR_PRIVATE_KEY_HEX");
  return Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(hex, "hex")));
}

function deepBookClient(cfg: Config, client: SuiClient, address: string): DeepBookClient {
  return new DeepBookClient({
    client,
    address,
    env: "testnet",
    // Register the agent's BalanceManager so SDK calls can reference it by key.
    balanceManagers: {
      [cfg.balanceManagerKey]: {
        address: cfg.balanceManagerId,
        tradeCap: undefined, // owner-signed; no separate TradeCap in this demo
      },
    },
  });
}

/**
 * The strategy tick: spend under the cap and place a DeepBook order, atomically.
 */
async function runStrategy(): Promise<void> {
  const cfg = loadConfig();
  const client = new SuiClient({ url: cfg.rpcUrl });
  const keypair = operatorKeypair();
  const address = keypair.toSuiAddress();
  const db = deepBookClient(cfg, client, address);

  const tx = new Transaction();

  // 1. Budget-gated spend. Move enforces: cap matches treasury, active (not
  //    revoked), not expired, and spent_today + amount <= daily_limit_sui.
  //    Returns the Coin<SUI> for atomic composition.
  const [payout] = tx.moveCall({
    target: `${cfg.taiPackageId}::agent_treasury::operator_spend_sui_coin`,
    typeArguments: [cfg.coinType],
    arguments: [
      tx.object(cfg.agentTreasuryId),
      tx.object(cfg.operatorCapId),
      tx.pure.u64(cfg.budgetMist),
      tx.object(SUI_CLOCK),
    ],
  });

  // 2. Deposit the just-spent coin into the agent's DeepBook BalanceManager.
  //    CONFIRM: deposit signature on your deepbookv3 version. Typically
  //    `balance_manager::deposit<T>(manager: &mut BalanceManager, coin: Coin<T>, ctx)`.
  tx.moveCall({
    target: `${cfg.deepbookPackageId}::balance_manager::deposit`,
    typeArguments: [SUI_TYPE],
    arguments: [tx.object(cfg.balanceManagerId), payout],
  });

  // 3. Place a real limit order from the funded manager (SDK tx-modifier).
  //    payWithDeep:false uses the input token for fees (no DEEP needed);
  //    set true and fund DEEP for the cheaper fee tier.
  tx.add(
    db.deepBook.placeLimitOrder({
      poolKey: cfg.poolKey,
      balanceManagerKey: cfg.balanceManagerKey,
      clientOrderId: String(Date.now()), // unique per order
      price: cfg.orderPrice,
      quantity: cfg.orderQuantity,
      isBid: cfg.isBid,
      payWithDeep: false,
    }),
  );

  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  console.error(`[strategy] tx ${res.digest} status=${res.effects?.status?.status}`);
  for (const ev of res.events ?? []) {
    console.error(`[strategy] event ${ev.type}`);
  }
  console.log(JSON.stringify({ digest: res.digest, events: res.events?.length ?? 0 }));
}

/**
 * One-time: create + share a BalanceManager for the agent. Print its id to set
 * as BALANCE_MANAGER_ID for subsequent runs.
 */
async function setupBalanceManager(): Promise<void> {
  const cfg = loadConfig();
  const client = new SuiClient({ url: cfg.rpcUrl });
  const keypair = operatorKeypair();
  const db = deepBookClient(cfg, client, keypair.toSuiAddress());

  const tx = new Transaction();
  tx.add(db.balanceManager.createAndShareBalanceManager());
  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showObjectChanges: true },
  });
  console.error(`[setup] tx ${res.digest}`);
  // CONFIRM: find the created BalanceManager id in res.objectChanges and set it
  // as BALANCE_MANAGER_ID.
  console.log(JSON.stringify(res.objectChanges ?? [], null, 2));
}

const mode = process.argv[2] ?? "run";
const main = mode === "setup" ? setupBalanceManager : runStrategy;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
