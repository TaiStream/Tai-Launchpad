/**
 * Typed views over Tai on-chain objects. Mirrors `rust/tai-core/src/reads.rs`
 * shapes. Handles the v1.0.1 (no `version` field) and v1.0.2 (with `version`)
 * accounts transparently.
 *
 * Numeric on-chain values arrive as strings to preserve u64 precision; we
 * keep them as `bigint`s and let render-time formatters decide units.
 */

import {
  EventFilter,
  SuiEvent,
  SuiObjectData,
  SuiObjectFields,
  getObject,
  queryEvents,
} from "./sui";
import { ALL_PACKAGES, TAI } from "./config";

// ============================= helpers =====================================

function str(fields: SuiObjectFields, key: string): string {
  const v = fields[key];
  if (typeof v !== "string") {
    throw new Error(`Field "${key}" expected string, got ${typeof v}`);
  }
  return v;
}

function num(fields: SuiObjectFields, key: string): bigint {
  const v = fields[key];
  if (typeof v !== "string" && typeof v !== "number") {
    throw new Error(`Field "${key}" expected number/string, got ${typeof v}`);
  }
  return BigInt(v as string | number);
}

function maybeNum(fields: SuiObjectFields, key: string): bigint | null {
  const v = fields[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  return BigInt(v as string | number);
}

function bool(fields: SuiObjectFields, key: string): boolean {
  const v = fields[key];
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "false") return v === "true";
  throw new Error(`Field "${key}" expected bool, got ${typeof v}`);
}

/** Sui's Balance<T> shape: either { value: "..." } or just "..." in some shapes. */
function balance(fields: SuiObjectFields, key: string): bigint {
  const v = fields[key];
  if (v === undefined) throw new Error(`Field "${key}" missing`);
  if (typeof v === "object" && v !== null && "value" in v) {
    return BigInt((v as { value: string | number }).value);
  }
  if (typeof v === "string" || typeof v === "number") {
    return BigInt(v as string | number);
  }
  throw new Error(`Field "${key}" not a Balance shape`);
}

/** Sui's Option<ID> shape: { vec: [] } or { vec: ["0x..."] }. */
function optionId(fields: SuiObjectFields, key: string): string | null {
  const v = fields[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "object" && "vec" in v) {
    const vec = (v as { vec: string[] }).vec;
    return vec.length > 0 ? vec[0] : null;
  }
  return null;
}

// ============================= LaunchpadConfig =============================

export type LaunchpadConfigView = {
  objectId: string;
  packageVersion: string;
  /** Move-side schema version (1 on v1.0.2, missing on v1.0.1). */
  schemaVersion: bigint | null;
  admin: string;
  platformTreasury: string;
  tradeFeeBps: bigint;
  tradeNavShareBps: bigint;
  tradeCreatorShareBps: bigint;
  tradePlatformShareBps: bigint;
  serviceNavShareBps: bigint;
  serviceCreatorShareBps: bigint;
  servicePlatformShareBps: bigint;
  tokenServiceNavShareBps: bigint;
  tokenServiceBurnShareBps: bigint;
  tokenServiceCreatorShareBps: bigint;
  virtualSuiReserves: bigint;
  virtualTokenReserves: bigint;
  saleSupply: bigint;
  lpSupply: bigint;
  credRevenueTarget: bigint;
};

function parseLaunchpadConfig(
  obj: SuiObjectData,
  packageVersion: string,
): LaunchpadConfigView {
  const f = obj.content?.fields ?? {};
  return {
    objectId: obj.objectId,
    packageVersion,
    schemaVersion: maybeNum(f, "version"),
    admin: str(f, "admin"),
    platformTreasury: str(f, "platform_treasury"),
    tradeFeeBps: num(f, "trade_fee_bps"),
    tradeNavShareBps: num(f, "trade_nav_share_bps"),
    tradeCreatorShareBps: num(f, "trade_creator_share_bps"),
    tradePlatformShareBps: num(f, "trade_platform_share_bps"),
    serviceNavShareBps: num(f, "service_nav_share_bps"),
    serviceCreatorShareBps: num(f, "service_creator_share_bps"),
    servicePlatformShareBps: num(f, "service_platform_share_bps"),
    tokenServiceNavShareBps: num(f, "token_service_nav_share_bps"),
    tokenServiceBurnShareBps: num(f, "token_service_burn_share_bps"),
    tokenServiceCreatorShareBps: num(f, "token_service_creator_share_bps"),
    virtualSuiReserves: num(f, "virtual_sui_reserves"),
    virtualTokenReserves: num(f, "virtual_token_reserves"),
    saleSupply: num(f, "sale_supply"),
    lpSupply: num(f, "lp_supply"),
    credRevenueTarget: num(f, "cred_revenue_target"),
  };
}

export async function fetchLaunchpadConfig(
  configId: string,
  packageVersion = "v1.0.2",
): Promise<LaunchpadConfigView> {
  const obj = await getObject(configId);
  return parseLaunchpadConfig(obj, packageVersion);
}

// ============================= LaunchpadAccount ============================

export type LaunchpadAccountView = {
  objectId: string;
  /** Which Tai package this account belongs to ("v1.0.1" or "v1.0.2"). */
  packageVersion: string;
  /** The full `T` type name (e.g. 0x14880acc...::larry::LARRY). */
  coinType: string;
  /** On-object schemaVersion; null on legacy v1.0.1 accounts. */
  schemaVersion: bigint | null;
  creator: string;
  linkedIdentity: string | null;
  coinTypeName: string;
  totalSupply: bigint;
  decimals: number;
  realSui: bigint;
  realToken: bigint;
  virtualSui: bigint;
  virtualToken: bigint;
  lpReserve: bigint;
  navSui: bigint;
  navToken: bigint;
  accessThreshold: bigint;
  acceptCoinPayments: boolean;
  lifetimeServiceRevenueSui: bigint;
  credRevenueTarget: bigint;
  treasuryCapHolderId: string;
  agentTreasuryId: string;
  ownerCapId: string;
  dwalletsObjectId: string | null;
  totalBuys: bigint;
  totalSells: bigint;
  totalServicePaymentsSui: bigint;
  totalServicePaymentsToken: bigint;
  cumulativeVolumeSui: bigint;
  cumulativeFeesSui: bigint;
  launchedAt: bigint;
};

/** Extract the inner `T` from `0xPKG::launchpad::LaunchpadAccount<T>`. */
function coinTypeFromAccountType(type: string): string {
  const lt = type.indexOf("<");
  const gt = type.lastIndexOf(">");
  if (lt < 0 || gt < 0) return "";
  return type.slice(lt + 1, gt);
}

/** Extract the inner `T` from `0xPKG::launchpad::TreasuryCapHolder<T>`. */
function coinTypeFromGenericType(type: string): string {
  return coinTypeFromAccountType(type);
}

function packageVersionForType(type: string): string {
  // Object + event TYPES are anchored to the original-published package id,
  // not the upgraded one — so match against typeOriginId.
  for (const p of ALL_PACKAGES) {
    if (type.startsWith(`${p.typeOriginId}::`)) return p.label;
  }
  return "?";
}

function parseLaunchpadAccount(obj: SuiObjectData): LaunchpadAccountView {
  const f = obj.content?.fields ?? {};
  const t = obj.type;
  const coinType = coinTypeFromAccountType(t);
  return {
    objectId: obj.objectId,
    packageVersion: packageVersionForType(t),
    coinType,
    schemaVersion: maybeNum(f, "version"),
    creator: str(f, "creator"),
    linkedIdentity: optionId(f, "linked_identity"),
    coinTypeName: str(f, "coin_type_name"),
    totalSupply: num(f, "total_supply"),
    decimals: Number(num(f, "decimals")),
    realSui: balance(f, "real_sui_balance"),
    realToken: balance(f, "real_token_balance"),
    virtualSui: num(f, "virtual_sui_reserves"),
    virtualToken: num(f, "virtual_token_reserves"),
    lpReserve: balance(f, "lp_reserve"),
    navSui: balance(f, "nav_sui"),
    navToken: balance(f, "nav_token"),
    accessThreshold: num(f, "access_threshold"),
    acceptCoinPayments: bool(f, "accept_coin_payments"),
    lifetimeServiceRevenueSui: num(f, "lifetime_service_revenue_sui"),
    credRevenueTarget: num(f, "cred_revenue_target"),
    treasuryCapHolderId: str(f, "treasury_cap_holder_id"),
    agentTreasuryId: str(f, "agent_treasury_id"),
    ownerCapId: str(f, "owner_cap_id"),
    dwalletsObjectId: optionId(f, "dwallets_object_id"),
    totalBuys: num(f, "total_buys"),
    totalSells: num(f, "total_sells"),
    totalServicePaymentsSui: num(f, "total_service_payments_sui"),
    totalServicePaymentsToken: num(f, "total_service_payments_token"),
    cumulativeVolumeSui: num(f, "cumulative_volume_sui"),
    cumulativeFeesSui: num(f, "cumulative_fees_sui"),
    launchedAt: num(f, "launched_at"),
  };
}

export async function fetchLaunchpadAccount(
  objectId: string,
): Promise<LaunchpadAccountView> {
  const obj = await getObject(objectId);
  return parseLaunchpadAccount(obj);
}

// ============================= AgentTreasury ===============================

export type AgentTreasuryView = {
  objectId: string;
  packageVersion: string;
  coinType: string;
  launchpadAccountId: string;
  ownerCapId: string;
  activeOperatorCapIds: string[];
  suiBalance: bigint;
  tokenBalance: bigint;
};

function parseAgentTreasury(obj: SuiObjectData): AgentTreasuryView {
  const f = obj.content?.fields ?? {};
  const t = obj.type;
  return {
    objectId: obj.objectId,
    packageVersion: packageVersionForType(t),
    coinType: coinTypeFromGenericType(t),
    launchpadAccountId: str(f, "launchpad_account_id"),
    ownerCapId: str(f, "owner_cap_id"),
    activeOperatorCapIds: (f["active_operator_cap_ids"] as string[]) ?? [],
    suiBalance: balance(f, "sui_balance"),
    tokenBalance: balance(f, "token_balance"),
  };
}

export async function fetchAgentTreasury(
  objectId: string,
): Promise<AgentTreasuryView> {
  const obj = await getObject(objectId);
  return parseAgentTreasury(obj);
}

// ============================= Display<OwnerCap<T>> ========================

export type DisplayView = {
  objectId: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  link?: string;
  projectUrl?: string;
  creator?: string;
};

export async function fetchDisplay(
  objectId: string,
): Promise<DisplayView | null> {
  try {
    const obj = await getObject(objectId);
    const fields = obj.content?.fields ?? {};
    const fieldsObj = fields["fields"] as
      | { fields: { contents: Array<{ fields: { key: string; value: string } }> } }
      | undefined;
    if (!fieldsObj) return { objectId: obj.objectId };
    const contents = fieldsObj.fields?.contents ?? [];
    const map: Record<string, string> = {};
    for (const c of contents) {
      const k = c.fields?.key;
      const v = c.fields?.value;
      if (k && typeof v === "string") map[k] = v;
    }
    return {
      objectId: obj.objectId,
      name: map["name"],
      description: map["description"],
      imageUrl: map["image_url"],
      link: map["link"],
      projectUrl: map["project_url"],
      creator: map["creator"],
    };
  } catch {
    return null;
  }
}

// ============================= Bonding-curve math =========================

/**
 * Mirror of `tai::bonding_curve::compute_buy` from the Move source.
 * Returns `(tokens_out, fee_sui)` for a buy of `sui_in` against a pool with
 * the given (real, virtual) reserves. Ceiling division on the new total
 * token to preserve the protocol's path-dependence invariant.
 *
 * All math is done in `bigint` to avoid JS-Number precision loss at u64
 * boundaries (specifically the `(real + virtual) * (real + virtual)`
 * intermediate which can exceed 2^53).
 */
export function computeBuy(
  realSui: bigint,
  realToken: bigint,
  virtualSui: bigint,
  virtualToken: bigint,
  suiIn: bigint,
  feeBps: bigint,
): { tokensOut: bigint; fee: bigint } {
  if (suiIn === 0n) return { tokensOut: 0n, fee: 0n };
  const fee = (suiIn * feeBps) / 10_000n;
  const suiNet = suiIn - fee;
  const totalSui = realSui + virtualSui;
  const totalToken = realToken + virtualToken;
  const k = totalSui * totalToken;
  const newTotalSui = totalSui + suiNet;
  // Ceiling division: (k + d - 1) / d.
  const newTotalToken = (k + newTotalSui - 1n) / newTotalSui;
  const tokensOut = totalToken - newTotalToken;
  return { tokensOut, fee };
}

/** Mirror of `tai::bonding_curve::compute_sell`. */
export function computeSell(
  realSui: bigint,
  realToken: bigint,
  virtualSui: bigint,
  virtualToken: bigint,
  tokensIn: bigint,
  feeBps: bigint,
): { suiOut: bigint; fee: bigint } {
  if (tokensIn === 0n) return { suiOut: 0n, fee: 0n };
  const totalSui = realSui + virtualSui;
  const totalToken = realToken + virtualToken;
  const k = totalSui * totalToken;
  const newTotalToken = totalToken + tokensIn;
  // Ceiling division — mirrors bonding_curve.move (protocol keeps the 1-MIST
  // remainder; floor here would over-estimate sui_out by up to 1 MIST).
  const newTotalSui = (k + newTotalToken - 1n) / newTotalToken;
  const suiGross = totalSui - newTotalSui;
  const fee = (suiGross * feeBps) / 10_000n;
  const suiOut = suiGross - fee;
  return { suiOut, fee };
}

// ============================= Hire-quote view =============================

/**
 * Mirror of `tai::views::hire_quote`. Pure math.
 *
 * hire_price = nav * mult_bps / 10_000
 * mult_bps   = 10_000 + min(10_000, earned * 10_000 / target)
 */
export function hireQuote(
  navSui: bigint,
  earned: bigint,
  target: bigint,
): {
  multBps: bigint;
  hirePrice: bigint;
} {
  if (target === 0n) {
    return { multBps: 10_000n, hirePrice: navSui };
  }
  const bonus = (earned * 10_000n) / target;
  const capped = bonus > 10_000n ? 10_000n : bonus;
  const multBps = 10_000n + capped;
  const hirePrice = (navSui * multBps) / 10_000n;
  return { multBps, hirePrice };
}

// ============================= LaunchEvent harvesting ======================

export type LaunchEventInfo = {
  launchpadId: string;
  agentTreasuryId: string;
  ownerCapId: string;
  treasuryCapHolderId: string;
  coinTypeName: string;
  creator: string;
  linkedIdentity: string | null;
  timestampMs: bigint;
  packageVersion: string;
  txDigest: string;
};

function parseLaunchEvent(ev: SuiEvent): LaunchEventInfo {
  const p = ev.parsedJson;
  const linked = p["linked_identity"] as
    | { vec: string[] }
    | string[]
    | null
    | undefined;
  let linkedIdentity: string | null = null;
  if (linked && typeof linked === "object" && "vec" in linked) {
    const vec = (linked as { vec: string[] }).vec;
    linkedIdentity = vec.length ? vec[0] : null;
  } else if (Array.isArray(linked)) {
    linkedIdentity = linked.length ? linked[0] : null;
  }
  return {
    launchpadId: String(p["launchpad_id"]),
    agentTreasuryId: String(p["agent_treasury_id"]),
    ownerCapId: String(p["owner_cap_id"]),
    treasuryCapHolderId: String(p["treasury_cap_holder_id"]),
    coinTypeName: String(p["coin_type_name"]),
    creator: String(p["creator"]),
    linkedIdentity,
    timestampMs: BigInt(String(p["timestamp"] ?? "0")),
    packageVersion: packageVersionForType(ev.type),
    txDigest: ev.id.txDigest,
  };
}

/** All LaunchEvents emitted by *any* known Tai package, newest first. */
export async function fetchAllLaunchEvents(
  limit = 50,
): Promise<LaunchEventInfo[]> {
  const out: LaunchEventInfo[] = [];
  for (const pkg of ALL_PACKAGES) {
    const filter: EventFilter = {
      MoveEventType: `${pkg.typeOriginId}::launchpad::LaunchEvent`,
    };
    try {
      const page = await queryEvents(filter, limit, true);
      for (const ev of page.data) {
        out.push(parseLaunchEvent(ev));
      }
    } catch {
      // Best-effort — a failed package query shouldn't kill the listing.
    }
  }
  out.sort((a, b) =>
    a.timestampMs < b.timestampMs ? 1 : a.timestampMs > b.timestampMs ? -1 : 0,
  );
  return out;
}

// ============================= TradeEvent / ServicePaymentEvent ============

export type TradeEventInfo = {
  kind: "trade";
  launchpadId: string;
  trader: string;
  isBuy: boolean;
  suiIn: bigint;
  tokensOut: bigint;
  suiOut: bigint;
  tokensIn: bigint;
  feeSui: bigint;
  newRealSuiBalance: bigint;
  newRealTokenBalance: bigint;
  timestampMs: bigint;
  txDigest: string;
};

export type ServicePaymentEventInfo = {
  kind: "service";
  launchpadId: string;
  payer: string;
  suiAmount: bigint;
  tokenAmount: bigint;
  countedTowardCred: boolean;
  newLifetimeRevenueSui: bigint;
  timestampMs: bigint;
  txDigest: string;
};

export type AgentEvent = TradeEventInfo | ServicePaymentEventInfo;

function parseTradeEvent(ev: SuiEvent): TradeEventInfo {
  const p = ev.parsedJson;
  return {
    kind: "trade",
    launchpadId: String(p["launchpad_id"]),
    trader: String(p["trader"]),
    isBuy: Boolean(p["is_buy"]),
    suiIn: BigInt(String(p["sui_in"] ?? "0")),
    tokensOut: BigInt(String(p["tokens_out"] ?? "0")),
    suiOut: BigInt(String(p["sui_out"] ?? "0")),
    tokensIn: BigInt(String(p["tokens_in"] ?? "0")),
    feeSui: BigInt(String(p["fee_sui"] ?? "0")),
    newRealSuiBalance: BigInt(String(p["new_real_sui_balance"] ?? "0")),
    newRealTokenBalance: BigInt(String(p["new_real_token_balance"] ?? "0")),
    timestampMs: BigInt(String(p["timestamp"] ?? "0")),
    txDigest: ev.id.txDigest,
  };
}

function parseServiceEvent(ev: SuiEvent): ServicePaymentEventInfo {
  const p = ev.parsedJson;
  return {
    kind: "service",
    launchpadId: String(p["launchpad_id"]),
    payer: String(p["payer"]),
    suiAmount: BigInt(String(p["sui_amount"] ?? "0")),
    tokenAmount: BigInt(String(p["token_amount"] ?? "0")),
    countedTowardCred: Boolean(p["counted_toward_cred"]),
    newLifetimeRevenueSui: BigInt(String(p["new_lifetime_revenue_sui"] ?? "0")),
    timestampMs: BigInt(String(p["timestamp"] ?? "0")),
    txDigest: ev.id.txDigest,
  };
}

/**
 * Pull recent trade + service-payment events for a given LaunchpadAccount id.
 * We query each event type per known package and filter client-side by
 * launchpad_id, because Sui's query filter doesn't support nested filters.
 */
export async function fetchAgentEvents(
  launchpadId: string,
  limitPerType = 25,
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for (const pkg of ALL_PACKAGES) {
    const tradeFilter: EventFilter = {
      MoveEventType: `${pkg.typeOriginId}::launchpad::TradeEvent`,
    };
    const serviceFilter: EventFilter = {
      MoveEventType: `${pkg.typeOriginId}::launchpad::ServicePaymentEvent`,
    };
    try {
      const [tp, sp] = await Promise.all([
        queryEvents(tradeFilter, limitPerType, true),
        queryEvents(serviceFilter, limitPerType, true),
      ]);
      for (const ev of tp.data) {
        const e = parseTradeEvent(ev);
        if (e.launchpadId === launchpadId) out.push(e);
      }
      for (const ev of sp.data) {
        const e = parseServiceEvent(ev);
        if (e.launchpadId === launchpadId) out.push(e);
      }
    } catch {
      /* swallow */
    }
  }
  out.sort((a, b) =>
    a.timestampMs < b.timestampMs ? 1 : a.timestampMs > b.timestampMs ? -1 : 0,
  );
  return out;
}

// ============================= Composite: agent snapshot ===================

export type AgentSnapshot = {
  account: LaunchpadAccountView;
  treasury: AgentTreasuryView;
  config: LaunchpadConfigView;
  display: DisplayView | null;
  events: AgentEvent[];
  /** Server-side timestamp of when this snapshot was assembled. */
  fetchedAtMs: number;
};

export async function fetchAgentSnapshot(
  launchpadAccountId: string,
  displayId?: string,
): Promise<AgentSnapshot> {
  const account = await fetchLaunchpadAccount(launchpadAccountId);
  const pkg = ALL_PACKAGES.find((p) => p.label === account.packageVersion);
  const configId = pkg?.configId ?? TAI.v1_0_2.configId;

  const [treasury, config, display, events] = await Promise.all([
    fetchAgentTreasury(account.agentTreasuryId),
    fetchLaunchpadConfig(configId, account.packageVersion),
    displayId ? fetchDisplay(displayId) : Promise.resolve(null),
    fetchAgentEvents(launchpadAccountId, 25),
  ]);

  return {
    account,
    treasury,
    config,
    display,
    events,
    fetchedAtMs: Date.now(),
  };
}

// ============================= WorkOrder<T> ================================

/** Status codes — mirror tai::work_order Move constants exactly. */
export const WORK_ORDER_STATUS = {
  NEW: 0,
  ACCEPTED: 1,
  RECEIPT_SUBMITTED: 2,
  RELEASED: 3,
  REFUNDED: 4,
  DISPUTED: 5,
} as const;

export type WorkOrderStatusCode =
  (typeof WORK_ORDER_STATUS)[keyof typeof WORK_ORDER_STATUS];

export function workOrderStatusLabel(s: WorkOrderStatusCode): string {
  switch (s) {
    case 0:
      return "new";
    case 1:
      return "accepted";
    case 2:
      return "receipt_submitted";
    case 3:
      return "released";
    case 4:
      return "refunded";
    case 5:
      return "disputed";
  }
}

export type WorkOrderView = {
  objectId: string;
  packageVersion: string;
  coinType: string;
  buyer: string;
  payeeLaunchpadAccountId: string;
  payeeAgentTreasuryId: string;
  amount: bigint;
  lockedSui: bigint;
  specHash: string;
  specUrl: string;
  receiptHash: string;
  receiptUrl: string;
  createdAtMs: bigint;
  deadlineMs: bigint;
  receiptSubmittedAtMs: bigint;
  disputeWindowMs: bigint;
  status: WorkOrderStatusCode;
};

function bytesField(fields: SuiObjectFields, key: string): string {
  const v = fields[key];
  if (v === undefined) return "";
  if (typeof v === "string") {
    // Sui surfaces vector<u8> as base64 OR ASCII; show as raw 0x-hex either way.
    try {
      const bytes = Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
      return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return v;
    }
  }
  if (Array.isArray(v)) {
    return (
      "0x" +
      (v as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
    );
  }
  return "";
}

function parseWorkOrder(obj: SuiObjectData): WorkOrderView {
  const f = obj.content?.fields ?? {};
  const t = obj.type;
  return {
    objectId: obj.objectId,
    packageVersion: packageVersionForType(t),
    coinType: coinTypeFromAccountType(t),
    buyer: str(f, "buyer"),
    payeeLaunchpadAccountId: str(f, "payee_launchpad_account_id"),
    payeeAgentTreasuryId: str(f, "payee_agent_treasury_id"),
    amount: num(f, "amount"),
    lockedSui: balance(f, "locked"),
    specHash: bytesField(f, "spec_hash"),
    specUrl: str(f, "spec_url"),
    receiptHash: bytesField(f, "receipt_hash"),
    receiptUrl: str(f, "receipt_url"),
    createdAtMs: num(f, "created_at_ms"),
    deadlineMs: num(f, "deadline_ms"),
    receiptSubmittedAtMs: num(f, "receipt_submitted_at_ms"),
    disputeWindowMs: num(f, "dispute_window_ms"),
    status: Number(num(f, "status")) as WorkOrderStatusCode,
  };
}

export async function fetchWorkOrder(objectId: string): Promise<WorkOrderView> {
  const obj = await getObject(objectId);
  return parseWorkOrder(obj);
}

/** Pull every work-order ever created across known packages, newest first. */
export async function fetchAllWorkOrderEvents(): Promise<
  Array<{ objectId: string; buyer: string; payeeLaunchpad: string; amount: bigint; createdAtMs: bigint; packageVersion: string }>
> {
  const out: Array<{
    objectId: string;
    buyer: string;
    payeeLaunchpad: string;
    amount: bigint;
    createdAtMs: bigint;
    packageVersion: string;
  }> = [];
  for (const pkg of ALL_PACKAGES) {
    const filter: EventFilter = {
      MoveEventType: `${pkg.typeOriginId}::work_order::WorkOrderCreatedEvent`,
    };
    try {
      const page = await queryEvents(filter, 50, true);
      for (const ev of page.data) {
        const p = ev.parsedJson;
        out.push({
          objectId: String(p["work_order_id"]),
          buyer: String(p["buyer"]),
          payeeLaunchpad: String(p["payee_launchpad_account_id"]),
          amount: BigInt(String(p["amount"] ?? "0")),
          createdAtMs: BigInt(String(p["created_at_ms"] ?? "0")),
          packageVersion: pkg.label,
        });
      }
    } catch {
      /* swallow */
    }
  }
  out.sort((a, b) =>
    a.createdAtMs < b.createdAtMs ? 1 : a.createdAtMs > b.createdAtMs ? -1 : 0,
  );
  return out;
}

/** All work orders targeting a given launchpad account. */
export async function fetchWorkOrdersForAgent(
  launchpadAccountId: string,
): Promise<WorkOrderView[]> {
  const all = await fetchAllWorkOrderEvents();
  const mine = all.filter((e) => e.payeeLaunchpad === launchpadAccountId);
  const views = await Promise.all(
    mine.map(async (e) => {
      try {
        return await fetchWorkOrder(e.objectId);
      } catch {
        return null;
      }
    }),
  );
  return views.filter((v): v is WorkOrderView => v !== null);
}

export { ALL_PACKAGES, TAI };
