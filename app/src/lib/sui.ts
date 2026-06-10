/**
 * Minimal Sui JSON-RPC client used server-side. Each function is one POST.
 * No SDK: the dashboard touches a tiny surface (getObject, multiGetObjects,
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

/** Per-attempt timeout for Sui RPC calls. Public testnet fullnodes can be
 *  flaky; we'd rather fail fast and try the next endpoint than hang. */
const RPC_TIMEOUT_MS = 15_000;

/** Endpoints tried in order; first success wins. The primary is SUI_RPC
 *  (env-overridable via SUI_RPC_URL); a public fallback keeps reads up if the
 *  primary is rate-limited or down during a traffic spike. */
const RPC_ENDPOINTS: string[] = Array.from(
  new Set(
    [SUI_RPC, "https://sui-testnet.public.blastapi.io"].filter(
      (e): e is string => Boolean(e),
    ),
  ),
);

/** A JSON-RPC method-level error (HTTP 200 with an `error` body). NOT an
 *  endpoint failure, so surface it rather than failing over to another node. */
class RpcMethodError extends Error {}

async function rpcOnce<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      // One round-trip to a public RPC; callers throttle via poll cadence.
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Sui RPC timeout (${RPC_TIMEOUT_MS}ms) on ${method}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Sui RPC HTTP ${res.status} on ${method}`);
  const body: JsonRpcResponse<T> = await res.json();
  if (body.error) {
    throw new RpcMethodError(
      `Sui RPC error on ${method}: ${body.error.message} (code ${body.error.code})`,
    );
  }
  return body.result as T;
}

async function rpcWithFailover<T>(
  method: string,
  params: unknown[],
): Promise<T> {
  let lastErr: unknown;
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      return await rpcOnce<T>(endpoint, method, params);
    } catch (err) {
      // A real method-level RPC error is not an endpoint problem, so don't fail
      // over (every node would return the same). Transport/timeout/HTTP errors
      // fall through to the next endpoint.
      if (err instanceof RpcMethodError) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Sui RPC failed on ${method} (all endpoints)`);
}

/**
 * Short-TTL read cache + in-flight coalescing.
 *
 * Public fullnodes are the latency floor here, and the dashboard re-issues a
 * handful of byte-for-byte identical reads on every navigation: the global
 * work-order event scan and the shared LaunchpadConfig object are the same for
 * every agent page. Caching them for a few seconds makes switching between
 * agents feel instant; coalescing dedupes the concurrent bursts a single render
 * fires. The TTL is far shorter than the ~15s live-view poll, so numbers a user
 * actually watches stay fresh. This only collapses redundant reads.
 *
 * Reads only (every method here is a query); errors are never cached.
 */
const RPC_CACHE_TTL_MS = 5_000;
const RPC_CACHE_MAX = 256;
type RpcCacheEntry = { expires: number; value: unknown };
const rpcCache = new Map<string, RpcCacheEntry>();
const rpcInflight = new Map<string, Promise<unknown>>();

function pruneRpcCache(now: number): void {
  for (const [k, entry] of rpcCache) {
    if (entry.expires <= now) rpcCache.delete(k);
  }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const key = `${method}:${JSON.stringify(params)}`;
  const now = Date.now();

  const hit = rpcCache.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const inflight = rpcInflight.get(key);
  if (inflight) return inflight as Promise<T>;

  const p = rpcWithFailover<T>(method, params)
    .then((value) => {
      if (rpcCache.size >= RPC_CACHE_MAX) pruneRpcCache(Date.now());
      rpcCache.set(key, { expires: Date.now() + RPC_CACHE_TTL_MS, value });
      rpcInflight.delete(key);
      return value;
    })
    .catch((err) => {
      rpcInflight.delete(key);
      throw err;
    });
  rpcInflight.set(key, p);
  return p;
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
