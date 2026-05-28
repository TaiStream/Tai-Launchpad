/**
 * Ecosystem-event poller + formatter. Larry's "real job" — at every 5-minute
 * cron tick, this:
 *
 *   1. Polls Sui RPC for new events across known Tai packages (v1.0.1,
 *      v1.0.2, v1.1.0).
 *   2. Deduplicates by `(txDigest, eventSeq)` via Workers KV (7-day TTL).
 *   3. Formats survivors in Larry's voice and posts to the configured
 *      Telegram channel.
 *
 * A separate daily-digest entry rolls the 24h numbers into one summary
 * message at 00:00 UTC.
 *
 * Larry is the analyst-in-residence. Posts are dry, terse, link to Suiscan
 * + the dashboard. Sponsored posts go through `/promote` (a separate route);
 * those are tagged `[paid post]` explicitly. Editorial integrity is the
 * whole point.
 */

import { sendPhoto, TelegramConfig, escapeHtml } from "./telegram";

const DASHBOARD = "https://tai-app-lyart.vercel.app";
const DEFAULT_IMAGE_URL = `${DASHBOARD}/mascot-square.png`;

// ─────────────────────────────────────────────────────────────────────────────
//  Package + event type registry
// ─────────────────────────────────────────────────────────────────────────────

const PACKAGES = [
    {
        label: "v1.1.0",
        packageId:
            "0x7d86697afc21895a94687ee5c16012384862d43dfd8a6841e2e4a0ac0690efb3",
    },
    {
        label: "v1.0.2",
        packageId:
            "0xa93885e3ec2191336a99dfa9a8f4db2bad4fb03a7431780d9153f9191d555026",
    },
    {
        label: "v1.0.1",
        packageId:
            "0xb41fa8ee7b2d902e706f197ec7e90484e4ded4347c6666d08eff09820e266909",
    },
] as const;

type EventKind =
    | "LaunchEvent"
    | "TradeEvent"
    | "ServicePaymentEvent"
    | "WorkOrderCreatedEvent"
    | "WorkOrderReleasedEvent"
    | "WorkOrderDisputedEvent";

const EVENT_KINDS: { kind: EventKind; module: string }[] = [
    { kind: "LaunchEvent", module: "launchpad" },
    { kind: "TradeEvent", module: "launchpad" },
    { kind: "ServicePaymentEvent", module: "launchpad" },
    { kind: "WorkOrderCreatedEvent", module: "work_order" },
    { kind: "WorkOrderReleasedEvent", module: "work_order" },
    { kind: "WorkOrderDisputedEvent", module: "work_order" },
];

// Posting thresholds — keep the feed signal, not noise.
const MIN_TRADE_MIST = 50_000_000;          // 0.05 SUI
const MIN_SERVICE_PAYMENT_MIST = 10_000_000; // 0.01 SUI

// ─────────────────────────────────────────────────────────────────────────────
//  Public entry points
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedEnv {
    SUI_RPC_URL: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
    /** KV namespace bound for cross-tick dedupe (`seen:<txd>:<seq>` keys). */
    FEED_STATE: KVNamespace;
    /** Optional override for the post image. Defaults to Larry's mascot. */
    LARRY_IMAGE_URL?: string;
}

/** Per-tick polling — collect new events, post each in Larry's voice. */
export async function tickEcosystemFeed(env: FeedEnv): Promise<void> {
    const tg: TelegramConfig = {
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
    };
    const imageUrl = env.LARRY_IMAGE_URL || DEFAULT_IMAGE_URL;
    const events = await collectNewEvents(env);
    // Post oldest-first so the channel reads chronologically.
    events.sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));
    for (const ev of events) {
        const message = renderEvent(ev);
        if (!message) continue;
        try {
            await sendPhoto(tg, imageUrl, message);
            await markSeen(env.FEED_STATE, ev);
        } catch (e) {
            // Don't mark as seen — let the next tick retry.
            console.error("telegram send failed", e);
        }
    }
}

/** Daily-digest entry — rolls 24h numbers into one summary post. */
export async function postDailyDigest(env: FeedEnv): Promise<void> {
    const tg: TelegramConfig = {
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
    };
    const imageUrl = env.LARRY_IMAGE_URL || DEFAULT_IMAGE_URL;
    const since = Date.now() - 24 * 3600 * 1000;
    const digest = await buildDigest(env, since);
    await sendPhoto(tg, imageUrl, digest);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Event collection
// ─────────────────────────────────────────────────────────────────────────────

interface RawEvent {
    kind: EventKind;
    packageLabel: string;
    packageId: string;
    txDigest: string;
    eventSeq: string;
    timestampMs: bigint;
    parsed: Record<string, unknown>;
    /** Full event type, e.g. `0xpkg::launchpad::TradeEvent` */
    eventType: string;
}

async function collectNewEvents(env: FeedEnv): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (const pkg of PACKAGES) {
        for (const { kind, module } of EVENT_KINDS) {
            const eventType = `${pkg.packageId}::${module}::${kind}`;
            try {
                const page = await queryEvents(env.SUI_RPC_URL, eventType, 30);
                for (const ev of page) {
                    const txd = ev.id?.txDigest;
                    const seq = ev.id?.eventSeq;
                    if (typeof txd !== "string" || typeof seq !== "string") continue;
                    const seenKey = `seen:${txd}:${seq}`;
                    const already = await env.FEED_STATE.get(seenKey);
                    if (already !== null) continue;
                    out.push({
                        kind,
                        packageLabel: pkg.label,
                        packageId: pkg.packageId,
                        txDigest: txd,
                        eventSeq: seq,
                        timestampMs: BigInt(String(ev.timestampMs ?? "0")),
                        parsed: (ev.parsedJson ?? {}) as Record<string, unknown>,
                        eventType,
                    });
                }
            } catch (e) {
                // Per-(package, kind) failure shouldn't kill the tick.
                console.error(`queryEvents failed for ${eventType}:`, e);
            }
        }
    }
    return out;
}

async function markSeen(kv: KVNamespace, ev: RawEvent): Promise<void> {
    const key = `seen:${ev.txDigest}:${ev.eventSeq}`;
    await kv.put(key, new Date().toISOString(), {
        expirationTtl: 7 * 24 * 3600,
    });
}

async function queryEvents(
    rpcUrl: string,
    eventType: string,
    limit: number,
): Promise<any[]> {
    const req = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "suix_queryEvents",
            params: [{ MoveEventType: eventType }, null, limit, true],
        }),
    });
    if (!req.ok) throw new Error(`HTTP ${req.status}`);
    const json: any = await req.json();
    if (json?.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
    return Array.isArray(json?.result?.data) ? json.result.data : [];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Formatting (Larry's voice)
// ─────────────────────────────────────────────────────────────────────────────

function renderEvent(ev: RawEvent): string | null {
    switch (ev.kind) {
        case "LaunchEvent":
            return renderLaunch(ev);
        case "TradeEvent":
            return renderTrade(ev);
        case "ServicePaymentEvent":
            return renderServicePayment(ev);
        case "WorkOrderCreatedEvent":
            return renderWorkOrderCreated(ev);
        case "WorkOrderReleasedEvent":
            return renderWorkOrderReleased(ev);
        case "WorkOrderDisputedEvent":
            return renderWorkOrderDisputed(ev);
    }
}

function renderLaunch(ev: RawEvent): string {
    const p = ev.parsed;
    const launchpadId = String(p["launchpad_id"]);
    const coinName = String(p["coin_type_name"] ?? "?");
    const creator = String(p["creator"] ?? "?");
    return [
        `<b>A new agent just turned up on Tai.</b>`,
        ``,
        `Coin · <code>${escapeHtml(shortType(coinName))}</code>`,
        `Creator · <a href="${suiscan("address", creator)}">${short(creator)}</a>`,
        `Package · ${ev.packageLabel}`,
        ``,
        `<a href="${DASHBOARD}/agent/${launchpadId}">open dashboard →</a> · <a href="${suiscan("object", launchpadId)}">on-chain →</a>`,
        ``,
        `<i>— Larry, your analyst-in-residence</i>`,
    ].join("\n");
}

function renderTrade(ev: RawEvent): string | null {
    const p = ev.parsed;
    const isBuy = p["is_buy"] === true;
    const sui = isBuy
        ? BigInt(String(p["sui_in"] ?? "0"))
        : BigInt(String(p["sui_out"] ?? "0"));
    if (sui < BigInt(MIN_TRADE_MIST)) return null;
    const launchpadId = String(p["launchpad_id"]);
    const trader = String(p["trader"] ?? "?");
    const tokens = isBuy
        ? BigInt(String(p["tokens_out"] ?? "0"))
        : BigInt(String(p["tokens_in"] ?? "0"));
    const fee = BigInt(String(p["fee_sui"] ?? "0"));
    const realSui = BigInt(String(p["new_real_sui_balance"] ?? "0"));
    const verb = isBuy ? "bought into" : "sold out of";
    return [
        `<b>Someone ${verb} an agent.</b>`,
        ``,
        `${isBuy ? "Paid" : "Received"} · ${mistToSui(sui)} SUI`,
        `${isBuy ? "Got" : "Sold"} · ${formatTokens(tokens)} tokens`,
        `Fee · ${mistToSui(fee, 5)} SUI`,
        `Pool now holds · ${mistToSui(realSui)} SUI`,
        ``,
        `Trader · <a href="${suiscan("address", trader)}">${short(trader)}</a>`,
        `<a href="${DASHBOARD}/agent/${launchpadId}">dashboard →</a> · <a href="${suiscan("tx", ev.txDigest)}">tx →</a>`,
        ``,
        `<i>— Larry</i>`,
    ].join("\n");
}

function renderServicePayment(ev: RawEvent): string | null {
    const p = ev.parsed;
    const sui = BigInt(String(p["sui_amount"] ?? "0"));
    if (sui < BigInt(MIN_SERVICE_PAYMENT_MIST)) return null;
    const launchpadId = String(p["launchpad_id"]);
    const payer = String(p["payer"] ?? "?");
    const counted = p["counted_toward_cred"] === true;
    const lifetime = BigInt(String(p["new_lifetime_revenue_sui"] ?? "0"));
    return [
        `<b>An agent just got hired.</b>`,
        ``,
        `Amount · ${mistToSui(sui, 4)} SUI`,
        `Lifetime · ${mistToSui(lifetime, 4)} SUI ${counted ? "" : "<i>(self-payment — NAV grew, cred did not)</i>"}`,
        ``,
        `Hirer · <a href="${suiscan("address", payer)}">${short(payer)}</a>`,
        `<a href="${DASHBOARD}/agent/${launchpadId}">dashboard →</a> · <a href="${suiscan("tx", ev.txDigest)}">tx →</a>`,
        ``,
        `<i>— Larry. Yes, I notice when someone earns more than me. No, I am not bitter.</i>`,
    ].join("\n");
}

function renderWorkOrderCreated(ev: RawEvent): string {
    const p = ev.parsed;
    const amount = BigInt(String(p["amount"] ?? "0"));
    const workOrderId = String(p["work_order_id"]);
    const launchpadId = String(p["payee_launchpad_account_id"]);
    const buyer = String(p["buyer"] ?? "?");
    const disputeMs = Number(String(p["dispute_window_ms"] ?? "0"));
    return [
        `<b>A new escrow hire just landed.</b>`,
        ``,
        `Locked · ${mistToSui(amount, 4)} SUI`,
        `Dispute window · ${formatDuration(disputeMs)}`,
        ``,
        `Buyer · <a href="${suiscan("address", buyer)}">${short(buyer)}</a>`,
        `<a href="${DASHBOARD}/work/${workOrderId}">order →</a> · <a href="${DASHBOARD}/agent/${launchpadId}">agent →</a>`,
        ``,
        `<i>— Larry</i>`,
    ].join("\n");
}

function renderWorkOrderReleased(ev: RawEvent): string {
    const p = ev.parsed;
    const amount = BigInt(String(p["amount"] ?? "0"));
    const workOrderId = String(p["work_order_id"]);
    const launchpadId = String(p["payee_launchpad_account_id"]);
    return [
        `<b>An escrow just released.</b>`,
        ``,
        `Routed · ${mistToSui(amount, 4)} SUI through the service-payment split.`,
        `Agent's NAV grew. Cred ticked up. Everyone went home.`,
        ``,
        `<a href="${DASHBOARD}/work/${workOrderId}">order →</a> · <a href="${DASHBOARD}/agent/${launchpadId}">agent →</a>`,
        ``,
        `<i>— Larry</i>`,
    ].join("\n");
}

function renderWorkOrderDisputed(ev: RawEvent): string {
    const p = ev.parsed;
    const workOrderId = String(p["work_order_id"]);
    return [
        `<b>A work order just hit dispute.</b>`,
        ``,
        `Funds locked pending admin review. Don't read anything into it yet.`,
        ``,
        `<a href="${DASHBOARD}/work/${workOrderId}">order →</a>`,
        ``,
        `<i>— Larry</i>`,
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Daily digest
// ─────────────────────────────────────────────────────────────────────────────

async function buildDigest(env: FeedEnv, sinceMs: number): Promise<string> {
    let launches = 0;
    let trades = 0;
    let tradeVolume = 0n;
    let serviceCount = 0;
    let serviceVolume = 0n;
    let workOrders = 0;
    let releases = 0;
    let releasedVolume = 0n;

    for (const pkg of PACKAGES) {
        for (const { kind, module } of EVENT_KINDS) {
            const eventType = `${pkg.packageId}::${module}::${kind}`;
            try {
                const page = await queryEvents(env.SUI_RPC_URL, eventType, 100);
                for (const ev of page) {
                    const ts = Number(ev.timestampMs ?? "0");
                    if (ts < sinceMs) continue;
                    const p = ev.parsedJson ?? {};
                    if (kind === "LaunchEvent") launches++;
                    else if (kind === "TradeEvent") {
                        trades++;
                        const v = p.is_buy
                            ? BigInt(String(p.sui_in ?? "0"))
                            : BigInt(String(p.sui_out ?? "0"));
                        tradeVolume += v;
                    } else if (kind === "ServicePaymentEvent") {
                        serviceCount++;
                        serviceVolume += BigInt(String(p.sui_amount ?? "0"));
                    } else if (kind === "WorkOrderCreatedEvent") workOrders++;
                    else if (kind === "WorkOrderReleasedEvent") {
                        releases++;
                        releasedVolume += BigInt(String(p.amount ?? "0"));
                    }
                }
            } catch (e) {
                console.error("digest queryEvents failed:", e);
            }
        }
    }

    const date = new Date().toISOString().slice(0, 10);
    return [
        `<b>Tai · 24h digest · ${date}</b>`,
        ``,
        `· <b>${launches}</b> new agent${launches === 1 ? "" : "s"} launched`,
        `· <b>${trades}</b> trade${trades === 1 ? "" : "s"} · ${mistToSui(tradeVolume, 4)} SUI volume`,
        `· <b>${serviceCount}</b> paid hire${serviceCount === 1 ? "" : "s"} · ${mistToSui(serviceVolume, 4)} SUI`,
        `· <b>${workOrders}</b> escrow${workOrders === 1 ? "" : "s"} opened, <b>${releases}</b> released (${mistToSui(releasedVolume, 4)} SUI)`,
        ``,
        `<a href="${DASHBOARD}/agents">browse agents →</a> · <a href="${DASHBOARD}/hire">hire →</a>`,
        ``,
        `<i>— Larry. Slow day or busy day, I show up.</i>`,
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function suiscan(kind: "address" | "tx" | "object", id: string): string {
    return `https://suiscan.xyz/testnet/${kind}/${id}`;
}

function short(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortType(t: string): string {
    if (!t.includes("::")) return t;
    const [a, ...rest] = t.split("::");
    return `${short(a)}::${rest.join("::")}`;
}

function mistToSui(mist: bigint | number, digits = 3): string {
    const n = typeof mist === "bigint" ? mist : BigInt(Math.floor(mist));
    const sign = n < 0n ? "-" : "";
    const abs = n < 0n ? -n : n;
    const whole = abs / 1_000_000_000n;
    const frac = abs % 1_000_000_000n;
    const fracStr = frac.toString().padStart(9, "0").slice(0, digits);
    return `${sign}${whole.toString()}.${fracStr}`;
}

function formatTokens(units: bigint): string {
    // Tai coins are 9-decimal by convention. Group whole portion.
    const div = 1_000_000_000n;
    const whole = units / div;
    return groupNumber(whole.toString());
}

function groupNumber(s: string): string {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}
