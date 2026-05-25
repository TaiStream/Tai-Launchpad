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

interface Env {
    SUI_RPC_URL: string;
    TAI_PACKAGE_ID: string;
    LAUNCHPAD_ACCOUNT_ID: string;
    AGENT_NAME: string;
    AGENT_PERSONA: string;
    MIN_PAYMENT_MIST: string;
    PAYMENT_FRESHNESS_SECONDS: string;
    CONSUMED_TXS: KVNamespace;
    OPENAI_API_KEY?: string;
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
                default:
                    return json({ error: "not found" }, 404);
            }
        } catch (e: any) {
            return json({ error: "internal", message: String(e?.message ?? e) }, 500);
        }
    },
} satisfies ExportedHandler<Env>;

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
  <p>A Tai-launched, sovereign-mode AI agent. On-chain coin
  + bonding-curve pool + NAV + transferable ownership cap, hosted on
  Cloudflare Workers.</p>
  <h2>To hire:</h2>
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
    return {
        agent: env.AGENT_NAME,
        persona: env.AGENT_PERSONA,
        sui: {
            network: "testnet",
            rpc_url: env.SUI_RPC_URL,
            tai_package_id: env.TAI_PACKAGE_ID,
            launchpad_account_id: env.LAUNCHPAD_ACCOUNT_ID,
        },
        pricing: {
            min_payment_mist: Number(env.MIN_PAYMENT_MIST),
            min_payment_sui: Number(env.MIN_PAYMENT_MIST) / 1e9,
            payment_freshness_seconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
        },
        hire_protocol: {
            step_1: "Submit a Sui PTB calling tai::launchpad::record_service_payment_sui on this agent's launchpad_account_id.",
            step_2: "POST /hire { question, payment_tx_digest } here.",
            step_3: "Receive verified response.",
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

    // Verify on-chain.
    let payment: VerifiedPayment;
    try {
        payment = await verifyServicePayment(body.payment_tx_digest, {
            rpcUrl: env.SUI_RPC_URL,
            launchpadAccountId: env.LAUNCHPAD_ACCOUNT_ID,
            minPaymentMist: Number(env.MIN_PAYMENT_MIST),
            freshnessSeconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
            requireExternalPayer: true,
        });
    } catch (e) {
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

    // Lock in the digest BEFORE generating the response so a long LLM call
    // can't be racing replays. 7-day TTL — beyond the freshness window plus
    // some slack.
    await env.CONSUMED_TXS.put(
        body.payment_tx_digest,
        new Date().toISOString(),
        { expirationTtl: 7 * 24 * 3600 },
    );

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
            sui_amount_mist: payment.suiAmount,
            counted_toward_cred: payment.countedTowardCred,
            new_lifetime_revenue_sui_mist: payment.newLifetimeRevenueSui,
        },
        disclaimer:
            "This response was produced by an autonomous agent runtime on Cloudflare Workers. It is not financial advice. Larry's analysis is for entertainment + research and reflects no human professional judgment.",
    });
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
