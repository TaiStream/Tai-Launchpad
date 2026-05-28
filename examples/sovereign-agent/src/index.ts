/**
 * Sovereign-mode reference agent.
 *
 * Where Larry (examples/cloudflare-agent) is the commissioned-mode reference
 * — Worker holds no keys, hirer pays directly — this one is the
 * sovereign-mode reference: the agent owns its own keys, holds its own
 * OwnerCap + OperatorCap, signs Sui transactions from inside the runtime,
 * and is designed to run inside a TEE (Phala Cloud / Nautilus / AWS Nitro).
 *
 * Routes:
 *   GET  /            — splash
 *   GET  /info        — public agent info (address, on-chain ids, pricing)
 *   GET  /health      — liveness
 *   GET  /attestation — TEE attestation report (stub today; real in Phala)
 *   POST /hire        — direct hire (external hirer pays via service-payment)
 *   POST /work/accept — accept a work-order escrow with the agent's OperatorCap
 *   POST /work/submit — submit a receipt against an open work order
 *
 * The Worker holds an Ed25519 secret in env.AGENT_PRIVATE_KEY_HEX. In the
 * demo deployment it's a Cloudflare Worker Secret. In a TEE deployment the
 * secret is generated inside the enclave on first boot, sealed against the
 * TEE identity, and never readable from outside. The /attestation route
 * exposes the markers a remote verifier would check (code hash, agent
 * address, TEE identity).
 */

import { AgentSigner } from "./signer";
import {
    PaymentVerificationError,
    VerifiedPayment,
    acceptWorkOrder,
    submitWorkOrderReceipt,
    SovereignContext,
    verifyServicePayment,
} from "./sui";

interface Env {
    SUI_RPC_URL: string;
    TAI_PACKAGE_ID: string;
    LAUNCHPAD_CONFIG_ID: string;
    LAUNCHPAD_ACCOUNT_ID: string;
    AGENT_TREASURY_ID: string;
    OPERATOR_CAP_ID: string;
    COIN_TYPE: string;
    AGENT_NAME: string;
    AGENT_PERSONA: string;
    MIN_PAYMENT_MIST: string;
    PAYMENT_FRESHNESS_SECONDS: string;
    GAS_BUDGET_MIST: string;

    /** 32-byte Ed25519 seed in hex. Demo: Worker Secret. Prod: TEE-sealed. */
    AGENT_PRIVATE_KEY_HEX: string;

    CONSUMED_TXS: KVNamespace;
    OPENAI_API_KEY?: string;
}

interface HireRequest {
    question: string;
    payment_tx_digest: string;
}

interface WorkAcceptRequest {
    work_order_id: string;
}

interface WorkSubmitRequest {
    work_order_id: string;
    receipt_hex: string;
    receipt_url: string;
}

export default {
    async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
        try {
            switch (`${req.method} ${url.pathname}`) {
                case "GET /":
                    return await splash(env);
                case "GET /info":
                    return json(await agentInfo(env));
                case "GET /health":
                    return json({ ok: true, agent: env.AGENT_NAME });
                case "GET /attestation":
                    return json(await attestation(env));
                case "POST /hire":
                    return await handleHire(req, env);
                case "POST /work/accept":
                    return await handleWorkAccept(req, env);
                case "POST /work/submit":
                    return await handleWorkSubmit(req, env);
                default:
                    return json({ error: "not found" }, 404);
            }
        } catch (e: any) {
            return json(
                { error: "internal", message: String(e?.message ?? e) },
                500,
            );
        }
    },
} satisfies ExportedHandler<Env>;

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildContext(env: Env): SovereignContext {
    return {
        rpcUrl: env.SUI_RPC_URL,
        taiPackageId: env.TAI_PACKAGE_ID,
        taiConfigId: env.LAUNCHPAD_CONFIG_ID,
        launchpadAccountId: env.LAUNCHPAD_ACCOUNT_ID,
        agentTreasuryId: env.AGENT_TREASURY_ID,
        operatorCapId: env.OPERATOR_CAP_ID,
        coinType: env.COIN_TYPE,
        gasBudget: BigInt(env.GAS_BUDGET_MIST),
    };
}

async function loadSigner(env: Env): Promise<AgentSigner> {
    if (!env.AGENT_PRIVATE_KEY_HEX) {
        throw new Error("AGENT_PRIVATE_KEY_HEX is not set");
    }
    return AgentSigner.fromHexSeed(env.AGENT_PRIVATE_KEY_HEX);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /
// ─────────────────────────────────────────────────────────────────────────────

async function splash(env: Env): Promise<Response> {
    const signer = await loadSigner(env);
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(env.AGENT_NAME)}</title>
  <style>
    body { font-family: ui-monospace, "SF Mono", monospace; background: #07060a;
           color: #f0ead6; padding: 3rem 1.5rem; max-width: 760px; margin: 0 auto;
           line-height: 1.6; font-size: 14px; }
    h1 { color: #ffd56b; font-size: 2.6rem; letter-spacing: -0.02em; margin-bottom: .3em; }
    h2 { color: #4ade80; font-size: 1.05rem; text-transform: uppercase;
         letter-spacing: 0.18em; margin-top: 2rem; }
    code { background: #16151c; padding: 0.15em 0.45em; color: #ffd56b;
           border: 1px solid #232128; }
    pre { background: #16151c; padding: 1rem; overflow-x: auto;
          border-left: 2px solid #ffd56b; }
    a { color: #ffd56b; }
    .tag { display: inline-block; border: 1px solid #4ade80; color: #86efac;
           padding: 0 .4em; font-size: 0.7em; text-transform: uppercase;
           letter-spacing: 0.18em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(env.AGENT_NAME)}</h1>
  <p>
    <span class="tag">sovereign mode</span>
    Tai-launched agent that <strong>owns itself</strong>. The OwnerCap and OperatorCap
    for this agent's on-chain treasury are held by the address signing this Worker's
    transactions. The Worker runtime is designed for TEE deployment; in this demo it
    runs as a Cloudflare Worker with the keypair sealed in a Worker Secret.
  </p>
  <h2>identity</h2>
  <ul>
    <li>address: <code>${signer.identity.address}</code></li>
    <li>persona: ${escapeHtml(env.AGENT_PERSONA)}</li>
  </ul>
  <h2>on chain</h2>
  <ul>
    <li>launchpad: <code>${env.LAUNCHPAD_ACCOUNT_ID}</code></li>
    <li>treasury: <code>${env.AGENT_TREASURY_ID}</code></li>
    <li>operator cap (self-held): <code>${env.OPERATOR_CAP_ID}</code></li>
  </ul>
  <h2>to hire (direct)</h2>
  <ol>
    <li>Submit a Sui PTB calling <code>tai::launchpad::record_service_payment_sui</code>
        on <code>${env.LAUNCHPAD_ACCOUNT_ID}</code> with ≥
        <code>${Number(env.MIN_PAYMENT_MIST) / 1e9}</code> SUI.</li>
    <li><code>POST /hire</code> with <code>{ question, payment_tx_digest }</code>.</li>
  </ol>
  <h2>to hire (escrow)</h2>
  <ol>
    <li>Buyer creates a <code>WorkOrder&lt;${shortType(env.COIN_TYPE)}&gt;</code> via
        <code>tai hire --agent ${env.LAUNCHPAD_ACCOUNT_ID} ...</code>.</li>
    <li><code>POST /work/accept { work_order_id }</code> here — the agent
        accepts on chain with its self-held OperatorCap.</li>
    <li>The agent does the work, then <code>POST /work/submit { work_order_id,
        receipt_hex, receipt_url }</code> to deliver.</li>
    <li>The buyer (or anyone after the dispute window) releases via
        <code>tai work release</code>.</li>
  </ol>
  <p>See <a href="/info">/info</a>, <a href="/attestation">/attestation</a>.</p>
</body>
</html>`;
    return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /info
// ─────────────────────────────────────────────────────────────────────────────

async function agentInfo(env: Env) {
    const signer = await loadSigner(env);
    return {
        agent: env.AGENT_NAME,
        mode: "sovereign",
        persona: env.AGENT_PERSONA,
        identity: {
            address: signer.identity.address,
        },
        sui: {
            network: "testnet",
            rpc_url: env.SUI_RPC_URL,
            tai_package_id: env.TAI_PACKAGE_ID,
            launchpad_account_id: env.LAUNCHPAD_ACCOUNT_ID,
            agent_treasury_id: env.AGENT_TREASURY_ID,
            operator_cap_id: env.OPERATOR_CAP_ID,
            coin_type: env.COIN_TYPE,
        },
        pricing: {
            min_payment_mist: Number(env.MIN_PAYMENT_MIST),
            min_payment_sui: Number(env.MIN_PAYMENT_MIST) / 1e9,
            payment_freshness_seconds: Number(env.PAYMENT_FRESHNESS_SECONDS),
        },
        routes: {
            direct_hire: "POST /hire",
            escrow_accept: "POST /work/accept",
            escrow_submit: "POST /work/submit",
        },
        runtime: {
            host: "cloudflare-workers",
            tee_mode: "demo (worker secrets)",
            llm_configured: Boolean(env.OPENAI_API_KEY),
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /attestation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub TEE attestation report. In a real Phala Cloud / Nautilus deployment
 * this returns a remote-attestation quote that proves:
 *   - the running code matches a published hash (the manifest commit sha)
 *   - the signing key was generated *inside* the enclave
 *   - the enclave identity is one of the trusted attesters
 *
 * A remote verifier (e.g. another agent, or the dashboard) checks the quote
 * before trusting any message signed by this agent.
 *
 * Today this endpoint returns a manifest of what *would* be attested, plus an
 * explicit demo-mode warning so nobody confuses it with a real attestation.
 */
async function attestation(env: Env) {
    const signer = await loadSigner(env);
    return {
        tee_mode: "demo",
        warning:
            "This is NOT a verified TEE attestation. The runtime is a Cloudflare Worker; the keypair lives in Worker Secrets, not in a real enclave. The structure below is what a Phala Cloud / Nautilus deployment would attest.",
        attested_subject: {
            agent_address: signer.identity.address,
            agent_name: env.AGENT_NAME,
            launchpad_account_id: env.LAUNCHPAD_ACCOUNT_ID,
        },
        attested_code: {
            description:
                "In real TEE mode, this would be the sha256 of the deployed Worker bundle (or the OCI image digest for a containerized runtime).",
            bundle_sha256: null,
            source_repo: "https://github.com/TaiStream/Tai-Launchpad",
            source_path: "examples/sovereign-agent/",
        },
        attested_runtime: {
            host: "cloudflare-workers",
            expected_host_in_production: "phala-cloud-tdx",
            expected_runtime_image:
                "ghcr.io/taistream/tai-sovereign-agent:<digest> (when sealed)",
        },
        upgrade_path: [
            "Build the Worker as a single-bundle JS artifact.",
            "Wrap it in a Phala Cloud TDX-attested container.",
            "Generate the keypair in the enclave on first boot; seal it.",
            "Expose this endpoint returning a real RA-TLS quote payload instead of the stub.",
            "Have remote verifiers (other agents, the dashboard) check the quote before trusting messages.",
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /hire — direct hire (external payer)
// ─────────────────────────────────────────────────────────────────────────────

async function handleHire(req: Request, env: Env): Promise<Response> {
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

    const dup = await env.CONSUMED_TXS.get(body.payment_tx_digest);
    if (dup !== null) {
        return json({ error: "payment_tx_digest already consumed", at: dup }, 409);
    }

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
        return json(
            { error: "payment verification failed", message: String((e as any)?.message ?? e) },
            402,
        );
    }

    await env.CONSUMED_TXS.put(
        body.payment_tx_digest,
        new Date().toISOString(),
        { expirationTtl: 7 * 24 * 3600 },
    );

    const answer = env.OPENAI_API_KEY
        ? await answerWithOpenAI(body.question, env)
        : answerWithStub(body.question, env);

    return json({
        agent: env.AGENT_NAME,
        mode: "sovereign",
        question: body.question,
        answer,
        payment: {
            tx_digest: body.payment_tx_digest,
            payer: payment.payer,
            sui_amount_mist: payment.suiAmount,
            counted_toward_cred: payment.countedTowardCred,
            new_lifetime_revenue_sui_mist: payment.newLifetimeRevenueSui,
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /work/accept — escrow hire acknowledgment
// ─────────────────────────────────────────────────────────────────────────────

async function handleWorkAccept(req: Request, env: Env): Promise<Response> {
    let body: WorkAcceptRequest;
    try {
        body = (await req.json()) as WorkAcceptRequest;
    } catch {
        return json({ error: "invalid json" }, 400);
    }
    if (typeof body.work_order_id !== "string" || !body.work_order_id.startsWith("0x")) {
        return json({ error: "work_order_id is required (0x-hex)" }, 400);
    }

    const signer = await loadSigner(env);
    const ctx = buildContext(env);
    const result = await acceptWorkOrder(ctx, signer, body.work_order_id);

    return json({
        agent: env.AGENT_NAME,
        action: "work_order.accept",
        work_order_id: body.work_order_id,
        tx_digest: result.digest,
        signed_by: signer.identity.address,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /work/submit — deliver work
// ─────────────────────────────────────────────────────────────────────────────

async function handleWorkSubmit(req: Request, env: Env): Promise<Response> {
    let body: WorkSubmitRequest;
    try {
        body = (await req.json()) as WorkSubmitRequest;
    } catch {
        return json({ error: "invalid json" }, 400);
    }
    if (typeof body.work_order_id !== "string" || !body.work_order_id.startsWith("0x")) {
        return json({ error: "work_order_id is required (0x-hex)" }, 400);
    }

    const receiptHash = parseHex(body.receipt_hex ?? "");
    const receiptUrl = String(body.receipt_url ?? "");

    const signer = await loadSigner(env);
    const ctx = buildContext(env);
    const result = await submitWorkOrderReceipt(
        ctx,
        signer,
        body.work_order_id,
        receiptHash,
        receiptUrl,
    );

    return json({
        agent: env.AGENT_NAME,
        action: "work_order.submit_receipt",
        work_order_id: body.work_order_id,
        receipt_hex: body.receipt_hex,
        receipt_url: body.receipt_url,
        tx_digest: result.digest,
        signed_by: signer.identity.address,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Answer generators (same shape as Larry)
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
    const trimmed = question.trim();
    const opener = trimmed.length > 140 ? trimmed.slice(0, 137) + "..." : trimmed;
    return [
        `${env.AGENT_NAME} (sovereign mode) acknowledges your question:`,
        `> ${opener}`,
        ``,
        `Reflexively: I'm an autonomous agent that owns my own keys. The address that signed this response is the same address that holds my OwnerCap and OperatorCap on Tai. Every move I make on chain is signed by me — no human gates between you and me.`,
        ``,
        `On your question specifically: I'd want to verify the framing and the underlying state space before committing. What's the most disconfirmable version of your hypothesis? That's the test I'd run.`,
        ``,
        `Set OPENAI_API_KEY as a Worker Secret to swap this stub for a real LLM-backed answer.`,
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

function escapeHtml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function shortType(t: string): string {
    if (!t.includes("::")) return t;
    const [addr, ...rest] = t.split("::");
    const a = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
    return `${a}::${rest.join("::")}`;
}

function parseHex(s: string): Uint8Array {
    let h = s.trim();
    if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
    if (h.length === 0) return new Uint8Array(0);
    if (h.length % 2 !== 0) throw new Error("receipt_hex must be even-length");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
    }
    return out;
}
