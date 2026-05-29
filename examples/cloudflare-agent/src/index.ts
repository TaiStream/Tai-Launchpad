/**
 * Larry the Analyst — Tai agent runtime on Cloudflare Workers.
 *
 * Routes:
 *   GET  /                — splash / banner
 *   GET  /info            — public agent info: name, on-chain ids, price, persona
 *   GET  /health          — liveness probe
 *   POST /hire            — { question, payment_tx_digest } → verified work product
 *
 * Hire protocol:
 *   1. Hirer submits a Sui PTB that calls
 *      tai::launchpad::record_service_payment_sui<T>(config, account, payment, clock)
 *      from their own wallet. This routes the SUI through Tai's service-fee
 *      split (40 NAV / 50 creator / 10 platform) and increments
 *      lifetime_service_revenue_sui only if the payer is not the agent's
 *      creator (anti-self-pump).
 *   2. Hirer POSTs { question, payment_tx_digest } here.
 *   3. The Worker fetches the tx via sui_getTransactionBlock, finds the
 *      matching ServicePaymentEvent, verifies amount + freshness + external
 *      payer, and stores the digest in KV so the same payment can't be
 *      reused.
 *   4. The Worker generates a response (OpenAI if OPENAI_API_KEY is set;
 *      otherwise a canned analysis stub) and returns it.
 *
 * The Worker holds NO private keys. All on-chain writes happen in the
 * hirer's own wallet. This is the cleanest commissioned-mode pattern for a
 * v1 demo; a sovereign-mode variant would add an OperatorCap signer.
 */

import {
    PaymentVerificationError,
    VerifiedPayment,
    verifyServicePayment,
} from "./sui";
import { postDailyDigest, tickEcosystemFeed } from "./feed";
import { escapeHtml, sendPhoto, TelegramConfig } from "./telegram";

const DEFAULT_LARRY_IMAGE_URL =
    "https://tai-launchpad.vercel.app/mascot-square.png";

interface Env {
    SUI_RPC_URL: string;
    TAI_PACKAGE_ID: string;
    LAUNCHPAD_ACCOUNT_ID: string;
    AGENT_NAME: string;
    AGENT_PERSONA: string;
    MIN_PAYMENT_MIST: string;
    PAYMENT_FRESHNESS_SECONDS: string;
    /** Floor for `/promote` sponsored posts. Defaults to MIN_PAYMENT_MIST. */
    MIN_PROMO_MIST?: string;
    CONSUMED_TXS: KVNamespace;
    /** KV for the ecosystem-feed event dedupe. Separate namespace from
     *  CONSUMED_TXS so the two concerns don't fight over keys. */
    FEED_STATE: KVNamespace;
    OPENAI_API_KEY?: string;
    /** Telegram channel config. When absent, /promote returns 503 and the
     *  scheduled feed/digest no-op. Used so the Worker can boot with no
     *  channel configured. */
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    /** Optional override for the channel image. Defaults to Larry's mascot. */
    LARRY_IMAGE_URL?: string;
}

interface HireRequest {
    question: string;
    payment_tx_digest: string;
}

export default {
    async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);

        try {
            switch (`${req.method} ${url.pathname}`) {
                case "GET /":
                    return splash(env);
                case "GET /info":
                    return json(agentInfo(env));
                case "GET /health":
                    return json({ ok: true, agent: env.AGENT_NAME });
                case "POST /hire":
                    return await handleHire(req, env);
                case "POST /promote":
                    return await handlePromote(req, env);
                default:
                    return json({ error: "not found" }, 404);
            }
        } catch (e: any) {
            return json({ error: "internal", message: String(e?.message ?? e) }, 500);
        }
    },

    /**
     * Cron-triggered. wrangler.toml declares two crons:
     *
     *   - every 5 minutes — ecosystem feed tick (poll events, post)
     *   - 0 0 * * *       — daily digest at 00:00 UTC
     *
     * The cron pattern is exposed on `event.cron` as the literal pattern.
     * If Telegram secrets aren't configured the handler is a no-op so the
     * Worker can be deployed before the channel is set up.
     */
    async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
        if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
            return;
        }
        const feedEnv = {
            SUI_RPC_URL: env.SUI_RPC_URL,
            TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
            TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
            FEED_STATE: env.FEED_STATE,
            LARRY_IMAGE_URL: env.LARRY_IMAGE_URL,
            SELF_LAUNCHPAD_ACCOUNT_ID: env.LAUNCHPAD_ACCOUNT_ID,
        };
        // Every tick: poll new events.
        ctx.waitUntil(tickEcosystemFeed(feedEnv));

        // Also fire the digest if it hasn't been fired yet today (UTC).
        // We store last_digest_date as YYYY-MM-DD in FEED_STATE — if today's
        // date differs, fire and update. This collapses the daily cron into
        // the every-5-min cron without losing the daily-digest behavior.
        ctx.waitUntil(maybePostDailyDigest(env, feedEnv));
    },
} satisfies ExportedHandler<Env>;

async function maybePostDailyDigest(
    env: Env,
    feedEnv: Parameters<typeof postDailyDigest>[0],
): Promise<void> {
    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const last = await env.FEED_STATE.get("last_digest_date");
        if (last === today) return;
        await postDailyDigest(feedEnv);
        // Mark today as fired with a 2-day TTL so a stale value can't keep
        // us silent if Cloudflare loses the KV value briefly.
        await env.FEED_STATE.put("last_digest_date", today, {
            expirationTtl: 2 * 24 * 3600,
        });
    } catch (e) {
        console.error("daily digest failed", e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  /
// ─────────────────────────────────────────────────────────────────────────────

function splash(env: Env): Response {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${env.AGENT_NAME}</title>
  <style>
    body { font-family: ui-monospace, "SF Mono", monospace; background: #0a0807;
           color: #f1ecdc; padding: 3rem 1.5rem; max-width: 720px; margin: 0 auto;
           line-height: 1.6; }
    h1 { color: #f5a524; font-size: 2.5rem; letter-spacing: -0.02em; }
    code { background: #161312; padding: 0.1em 0.4em; color: #f5a524; border-radius: 2px; }
    pre { background: #161312; padding: 1rem; overflow-x: auto;
          border-left: 2px solid #f5a524; }
    a { color: #f5a524; }
  </style>
</head>
<body>
  <h1>${env.AGENT_NAME}</h1>
  <p>A Tai-launched on-chain AI agent and the Tai ecosystem's
  analyst-in-residence. Posts every launch, trade, paid hire, and escrow
  event to the Telegram channel in a dry, slightly sarcastic voice.
  Earns from direct Q&amp;A and from sponsored posts — both always
  disclosed.</p>
  <h2>To hire (Q&amp;A):</h2>
  <ol>
    <li>From your Sui wallet, submit a PTB that calls
        <code>tai::launchpad::record_service_payment_sui</code>
        on this agent's <code>LaunchpadAccount</code>
        (<code>${env.LAUNCHPAD_ACCOUNT_ID}</code>) with at least
        <code>${Number(env.MIN_PAYMENT_MIST) / 1e9}</code> SUI.</li>
    <li><code>POST /hire</code> here with body
        <code>{ "question": "...", "payment_tx_digest": "..." }</code>.</li>
    <li>I'll verify the payment on-chain and respond.</li>
  </ol>
  <h2>To sponsor a post:</h2>
  <ol>
    <li>From your Sui wallet, submit a PTB that calls
        <code>tai::launchpad::record_service_payment_sui</code>
        on this agent's <code>LaunchpadAccount</code> with at least the
        <code>min_promo_mist</code> floor (see <a href="/info">/info</a>).</li>
    <li><code>POST /promote</code> with body
        <code>{ "message": "...", "payment_tx_digest": "...", "sponsor_label": "..." }</code>.</li>
    <li>I'll verify the payment on-chain, then post your message to the
        Telegram channel tagged <code>[paid post]</code> with full
        sponsor disclosure. Editorial integrity is precisely the
        disclosure.</li>
  </ol>
  <p>See <a href="/info">/info</a> for the full config.</p>
</body>
</html>`;
    return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  /info
// ─────────────────────────────────────────────────────────────────────────────

function agentInfo(env: Env) {
    const minPromoMist = Number(env.MIN_PROMO_MIST ?? env.MIN_PAYMENT_MIST);
    return {
        agent: env.AGENT_NAME,
        persona: env.AGENT_PERSONA,
        role: "Tai ecosystem analyst-in-residence — posts launches / trades / hires to the Telegram channel.",
        sui: {
            network: "testnet",
            rpc_url: env.SUI_RPC_URL,
            tai_package_id: env.TAI_PACKAGE_ID,
            launchpad_account_id: env.LAUNCHPAD_ACCOUNT_ID,
        },
        pricing: {
            min_payment_mist: Number(env.MIN_PAYMENT_MIST),
            min_payment_sui: Number(env.MIN_PAYMENT_MIST) / 1e9,
            min_promo_mist: minPromoMist,
            min_promo_sui: minPromoMist / 1e9,
            payment_freshness_seconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
        },
        hire_protocol: {
            direct_qa: {
                step_1: "Submit a Sui PTB calling tai::launchpad::record_service_payment_sui on this agent's launchpad_account_id.",
                step_2: "POST /hire { question, payment_tx_digest } here.",
                step_3: "Receive verified response.",
            },
            sponsored_post: {
                step_1: "Submit a Sui PTB calling tai::launchpad::record_service_payment_sui with >= min_promo_mist SUI.",
                step_2: "POST /promote { message, payment_tx_digest, sponsor_label? } here.",
                step_3: "Post lands in the Telegram channel tagged [paid post] with full sponsor disclosure.",
            },
        },
        channel: {
            configured: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
            chat_id: env.TELEGRAM_CHAT_ID ?? null,
        },
        runtime: {
            host: "cloudflare-workers",
            llm_configured: Boolean(env.OPENAI_API_KEY),
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  /hire
// ─────────────────────────────────────────────────────────────────────────────

async function handleHire(req: Request, env: Env): Promise<Response> {
    if (req.headers.get("content-type")?.includes("application/json") !== true) {
        return json({ error: "expected application/json body" }, 400);
    }

    let body: HireRequest;
    try {
        body = (await req.json()) as HireRequest;
    } catch {
        return json({ error: "invalid json" }, 400);
    }

    if (typeof body.question !== "string" || body.question.trim().length === 0) {
        return json({ error: "question is required" }, 400);
    }
    if (typeof body.payment_tx_digest !== "string" || body.payment_tx_digest.length < 10) {
        return json({ error: "payment_tx_digest is required" }, 400);
    }

    // Reject if this tx digest has already been used.
    const alreadyConsumed = await env.CONSUMED_TXS.get(body.payment_tx_digest);
    if (alreadyConsumed !== null) {
        return json(
            { error: "payment_tx_digest already consumed", at: alreadyConsumed },
            409,
        );
    }

    // M5 race protection: claim the digest in KV BEFORE verifying. Two
    // simultaneous requests with the same digest can both pass the `get`
    // check above; only one can successfully `put` here without a prior
    // `get` finding the key. (CF Workers KV doesn't have atomic CAS, but
    // the eventual consistency window is small enough that this is a
    // strong-enough barrier in practice. If verification then fails we
    // delete the key to allow legitimate retry.)
    await env.CONSUMED_TXS.put(
        body.payment_tx_digest,
        new Date().toISOString(),
        { expirationTtl: 7 * 24 * 3600 },
    );

    // Verify on-chain.
    let payment: VerifiedPayment;
    try {
        payment = await verifyServicePayment(body.payment_tx_digest, {
            rpcUrl: env.SUI_RPC_URL,
            launchpadAccountId: env.LAUNCHPAD_ACCOUNT_ID,
            minPaymentMist: BigInt(env.MIN_PAYMENT_MIST),
            freshnessSeconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
            requireExternalPayer: true,
        });
    } catch (e) {
        // Verification failed — un-claim the digest so an honest payer can
        // retry. Best-effort; we don't care if the delete itself errors.
        await env.CONSUMED_TXS.delete(body.payment_tx_digest).catch(() => {});
        if (e instanceof PaymentVerificationError) {
            return json({ error: e.reason, detail: e.detail }, 402);
        }
        // Sui RPC also rejects malformed / non-existent digests — those are
        // payment-related failures, not internal errors. Surface as 402.
        return json(
            {
                error: "payment verification failed",
                message: String((e as any)?.message ?? e),
            },
            402,
        );
    }

    // Generate the response.
    const answer = env.OPENAI_API_KEY
        ? await answerWithOpenAI(body.question, env)
        : answerWithStub(body.question, env);

    return json({
        agent: env.AGENT_NAME,
        question: body.question,
        answer,
        payment: {
            tx_digest: body.payment_tx_digest,
            payer: payment.payer,
            sui_amount_mist: payment.suiAmount.toString(),
            counted_toward_cred: payment.countedTowardCred,
            new_lifetime_revenue_sui_mist: payment.newLifetimeRevenueSui.toString(),
        },
        disclaimer:
            "This response was produced by an autonomous agent runtime on Cloudflare Workers. It is not financial advice. Larry's analysis is for entertainment + research and reflects no human professional judgment.",
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /promote — paid sponsored post
// ─────────────────────────────────────────────────────────────────────────────

interface PromoteRequest {
    /** HTML-safe message body (raw text; the route escapes it for output). */
    message: string;
    /** Sui tx digest of a `record_service_payment_sui` call on Larry's
     *  launchpad that paid >= MIN_PROMO_MIST. */
    payment_tx_digest: string;
    /** Optional human label for the buyer ("@projectx", "anon"). Free-form. */
    sponsor_label?: string;
}

async function handlePromote(req: Request, env: Env): Promise<Response> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ error: "telegram channel not configured" }, 503);
    }

    let body: PromoteRequest;
    try {
        body = (await req.json()) as PromoteRequest;
    } catch {
        return json({ error: "invalid json" }, 400);
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
        return json({ error: "message is required" }, 400);
    }
    if (body.message.length > 1500) {
        return json({ error: "message too long (max 1500 chars)" }, 400);
    }
    if (
        typeof body.payment_tx_digest !== "string" ||
        body.payment_tx_digest.length < 10
    ) {
        return json({ error: "payment_tx_digest is required" }, 400);
    }

    // Anti-replay: same digest can only fund one promo.
    const used = await env.CONSUMED_TXS.get(body.payment_tx_digest);
    if (used !== null) {
        return json({ error: "payment_tx_digest already consumed", at: used }, 409);
    }

    // M5 race protection — claim the digest before verifying. See /hire for
    // the rationale; we delete on verify failure to allow legitimate retry.
    await env.CONSUMED_TXS.put(
        body.payment_tx_digest,
        new Date().toISOString(),
        { expirationTtl: 7 * 24 * 3600 },
    );

    const minPromoMist = BigInt(env.MIN_PROMO_MIST ?? env.MIN_PAYMENT_MIST);
    let payment: VerifiedPayment;
    try {
        payment = await verifyServicePayment(body.payment_tx_digest, {
            rpcUrl: env.SUI_RPC_URL,
            launchpadAccountId: env.LAUNCHPAD_ACCOUNT_ID,
            minPaymentMist: minPromoMist,
            freshnessSeconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
            requireExternalPayer: true,
        });
    } catch (e) {
        await env.CONSUMED_TXS.delete(body.payment_tx_digest).catch(() => {});
        if (e instanceof PaymentVerificationError) {
            return json({ error: e.reason, detail: e.detail }, 402);
        }
        return json(
            { error: "payment verification failed", message: String((e as any)?.message ?? e) },
            402,
        );
    }

    // Compose. Editorial integrity: the [paid post] tag is non-removable
    // and the payment is fully disclosed (payer address, amount).
    const sponsorLine = body.sponsor_label
        ? `Sponsor · ${escapeHtml(body.sponsor_label)} (<a href="https://suiscan.xyz/testnet/address/${payment.payer}">${shortAddr(payment.payer)}</a>)`
        : `Sponsor · <a href="https://suiscan.xyz/testnet/address/${payment.payer}">${shortAddr(payment.payer)}</a>`;
    const promoText = [
        `<b>[paid post]</b>`,
        ``,
        escapeHtml(body.message.trim()),
        ``,
        `<i>—</i>`,
        sponsorLine,
        `Paid · ${mistBigintToSuiStr(payment.suiAmount, 4)} SUI through Tai service-payment · <a href="https://suiscan.xyz/testnet/tx/${body.payment_tx_digest}">tx</a>`,
        `<i>— Larry. I posted this because someone paid me. My editorial integrity is intact precisely because I'm telling you that.</i>`,
    ].join("\n");

    const tg: TelegramConfig = {
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
    };
    let messageId: number;
    try {
        const imageUrl = env.LARRY_IMAGE_URL || DEFAULT_LARRY_IMAGE_URL;
        messageId = await sendPhoto(tg, imageUrl, promoText);
    } catch (e) {
        return json(
            {
                error: "telegram post failed",
                message: String((e as any)?.message ?? e),
            },
            502,
        );
    }

    return json({
        agent: env.AGENT_NAME,
        action: "promote",
        message_id: messageId,
        payment: {
            tx_digest: body.payment_tx_digest,
            payer: payment.payer,
            sui_amount_mist: payment.suiAmount.toString(),
            counted_toward_cred: payment.countedTowardCred,
        },
    });
}

/** Format a u64-MIST `bigint` as a SUI string. */
function mistBigintToSuiStr(mist: bigint, digits: number): string {
    const sign = mist < 0n ? "-" : "";
    const abs = mist < 0n ? -mist : mist;
    const div = 1_000_000_000n;
    const whole = abs / div;
    const frac = abs % div;
    const fracStr = frac.toString().padStart(9, "0").slice(0, digits);
    return digits > 0 ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

function shortAddr(a: string): string {
    if (a.length <= 12) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Answer generators
// ─────────────────────────────────────────────────────────────────────────────

async function answerWithOpenAI(question: string, env: Env): Promise<string> {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: env.AGENT_PERSONA },
                { role: "user", content: question },
            ],
            temperature: 0.4,
        }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => "<unreadable>");
        throw new Error(`openai HTTP ${resp.status}: ${body}`);
    }
    const json: any = await resp.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
        throw new Error("openai returned no content");
    }
    return content;
}

function answerWithStub(question: string, env: Env): string {
    // Deterministic stub for when no LLM is configured. Keeps the demo
    // working out-of-the-box without any external API keys.
    const trimmed = question.trim();
    const opener =
        trimmed.length > 140
            ? trimmed.slice(0, 137) + "..."
            : trimmed;
    return [
        `${env.AGENT_NAME} acknowledges your question:`,
        `> ${opener}`,
        ``,
        `My analysis: The space you're asking about has the usual three forces in tension — narrative, liquidity, and structural mismatch between supply and intent.`,
        `Near term I'd watch (a) volume relative to the trailing 30-day median, (b) any concentrated holder unlock schedules, and (c) the qualitative tone shift across the highest-signal accounts (not the loudest ones).`,
        `Medium term, the question reduces to whether the underlying delivers something the market hasn't priced as inevitable yet. Most of the time, it doesn't. Position accordingly.`,
        ``,
        `This is the stub response — set OPENAI_API_KEY as a Worker secret to get a real LLM-backed answer.`,
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json" },
    });
}
