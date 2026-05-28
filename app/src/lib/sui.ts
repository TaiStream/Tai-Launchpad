/**
 * Minimal Sui JSON-RPC client used server-side. Each function is one POST.
 * No SDK — the dashboard touches a tiny surface (getObject, multiGetObjects,
 * queryEvents) and the official SDK adds far more weight than the savings
 * justify.
 */

import { SUI_RPC } from "./config";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

let nextId = 1;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    // Each request is one round-trip to a public RPC; no point caching at
    // the framework level. Callers throttle via revalidate / poll cadence.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sui RPC HTTP ${res.status} on ${method}`);
  const body: JsonRpcResponse<T> = await res.json();
  if (body.error) {
    throw new Error(
      `Sui RPC error on ${method}: ${body.error.message} (code ${body.error.code})`,
    );
  }
  return body.result as T;
}

// ============================= sui_getObject =============================

export type SuiObjectFields = Record<string, unknown>;

export type SuiObjectData = {
  objectId: string;
  version: string;
  digest: string;
  type: string;
  owner: unknown;
  previousTransaction?: string;
  content?: {
    dataType: "moveObject";
    type: string;
    fields: SuiObjectFields;
    hasPublicTransfer?: boolean;
  };
};

const DEFAULT_OPTIONS = {
  showType: true,
  showOwner: true,
  showPreviousTransaction: true,
  showDisplay: true,
  showContent: true,
  showBcs: false,
  showStorageRebate: false,
};

export async function getObject(objectId: string): Promise<SuiObjectData> {
  type Resp = { data?: SuiObjectData; error?: { code: string } };
  const r = await rpc<Resp>("sui_getObject", [objectId, DEFAULT_OPTIONS]);
  if (!r.data) {
    throw new Error(`Object not found: ${objectId}`);
  }
  return r.data;
}

export async function multiGetObjects(
  ids: string[],
): Promise<(SuiObjectData | null)[]> {
  if (ids.length === 0) return [];
  type Resp = { data?: SuiObjectData; error?: { code: string } }[];
  const r = await rpc<Resp>("sui_multiGetObjects", [ids, DEFAULT_OPTIONS]);
  return r.map((entry) => entry.data ?? null);
}

// ============================= suix_queryEvents =============================

export type EventFilter =
  | { MoveModule: { package: string; module: string } }
  | { MoveEventType: string }
  | { MoveEventModule: { package: string; module: string } }
  | { Package: string }
  | { Sender: string }
  | { TimeRange: { startTime: string; endTime: string } };

export type SuiEvent = {
  id: { txDigest: string; eventSeq: string };
  packageId: string;
  transactionModule: string;
  sender: string;
  type: string;
  parsedJson: Record<string, unknown>;
  timestampMs?: string;
};

export type EventPage = {
  data: SuiEvent[];
  nextCursor: { txDigest: string; eventSeq: string } | null;
  hasNextPage: boolean;
};

export async function queryEvents(
  filter: EventFilter,
  limit = 50,
  descending = true,
): Promise<EventPage> {
  return rpc<EventPage>("suix_queryEvents", [filter, null, limit, descending]);
}

// ============================= sui_getDynamicFields =========================

export type DynamicFieldInfo = {
  name: { type: string; value: unknown };
  bcsName: string;
  type: "DynamicField" | "DynamicObject";
  objectType: string;
  objectId: string;
  version: string;
  digest: string;
};

export type DynamicFieldsPage = {
  data: DynamicFieldInfo[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

export async function getDynamicFields(
  parent: string,
  limit = 50,
): Promise<DynamicFieldsPage> {
  return rpc<DynamicFieldsPage>("suix_getDynamicFields", [parent, null, limit]);
}

// ============================= sui_getLatestSuiSystemState ==================

export async function getLatestCheckpointSequenceNumber(): Promise<string> {
  return rpc<string>("sui_getLatestCheckpointSequenceNumber", []);
}
