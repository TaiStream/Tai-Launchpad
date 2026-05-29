import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchWorkOrder,
  fetchLaunchpadAccount,
  WORK_ORDER_STATUS,
  workOrderStatusLabel,
  WorkOrderStatusCode,
  WorkOrderView,
} from "@/lib/tai";
import { suiscan } from "@/lib/config";
import {
  mistToSui,
  shortAddr,
  shortType,
  timeAgo,
  utcStamp,
} from "@/lib/format";
import { KV, Panel, Tag } from "@/components/primitives";
import AutoRefresh from "@/components/AutoRefresh";
import LivePulse from "@/components/LivePulse";
import WorkOrderActions from "@/components/WorkOrderActions";

export const dynamic = "force-dynamic";

type RouteParams = { id: string };

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id } = await params;
  if (!id.startsWith("0x")) notFound();

  let order: WorkOrderView;
  try {
    order = await fetchWorkOrder(id);
  } catch {
    notFound();
  }

  // Resolve payee agent metadata for the side panel.
  let payeeName = "agent";
  try {
    const a = await fetchLaunchpadAccount(order.payeeLaunchpadAccountId);
    payeeName = a.coinTypeName || `Agent ${a.coinType.split("::").pop()}`;
  } catch {
    /* swallow */
  }

  const fetchedAtMs = Date.now();
  const statusLabel = workOrderStatusLabel(order.status);

  // Compute timeline derived markers.
  const receiptWindowEndMs = order.receiptSubmittedAtMs + order.disputeWindowMs;
  const now = Date.now();
  const inDisputeWindow =
    order.status === WORK_ORDER_STATUS.RECEIPT_SUBMITTED &&
    BigInt(now) < BigInt(receiptWindowEndMs);
  const pastDeadline = BigInt(now) >= order.deadlineMs;

  return (
    <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
      <AutoRefresh intervalMs={15_000} />

      <nav className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-phosphor-faint">
        <Link href="/" className="hover:text-phosphor">home</Link>
        <span>·</span>
        <Link href="/agents" className="hover:text-phosphor">agents</Link>
        <span>·</span>
        <span className="text-phosphor">{shortAddr(order.objectId, 6, 6)}</span>
      </nav>

      <header className="grid gap-6 border border-border bg-surface/85 p-6 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-4xl tracking-tight text-phosphor glow-amber md:text-5xl">
              work order
            </h1>
            <StatusBadge status={order.status} />
            <Tag variant={order.packageVersion === "v1.1" ? "green" : "neutral"}>
              {order.packageVersion}
            </Tag>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] tabular text-phosphor-dim md:grid-cols-2">
            <Field
              k="order id"
              v={
                <a
                  className="hover:text-amber-bright"
                  href={suiscan("object", order.objectId)}
                >
                  {shortAddr(order.objectId, 6, 6)}
                </a>
              }
            />
            <Field
              k="payee"
              v={
                <Link
                  className="hover:text-amber-bright"
                  href={`/agent/${order.payeeLaunchpadAccountId}`}
                >
                  {payeeName} · {shortAddr(order.payeeLaunchpadAccountId, 6, 6)}
                </Link>
              }
            />
            <Field
              k="buyer"
              v={
                <a
                  className="hover:text-amber-bright"
                  href={suiscan("address", order.buyer)}
                >
                  {shortAddr(order.buyer, 6, 6)}
                </a>
              }
            />
            <Field k="coin type" v={shortType(order.coinType)} />
          </dl>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <LivePulse fetchedAtMs={fetchedAtMs} />
          <a
            href={suiscan("object", order.objectId)}
            target="_blank"
            rel="noreferrer"
            className="border border-amber-dim/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/10"
          >
            view on suiscan →
          </a>
        </div>
      </header>

      {/* ============================= Big numbers ========================== */}
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <Panel title="amount" accent="amber" dense>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl text-amber-bright glow-amber tabular">
              {mistToSui(order.amount, 4)}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-phosphor-dim">
              SUI
            </span>
          </div>
          <div className="mt-1 text-[11px] tabular text-phosphor-dim">
            currently locked: {mistToSui(order.lockedSui, 4)} SUI
          </div>
        </Panel>
        <Panel title="status" dense>
          <div className="font-display text-2xl text-phosphor">
            {statusLabel.replaceAll("_", " ")}
          </div>
          <div className="mt-1 text-[12px] text-phosphor-dim">
            {statusDescription(order.status)}
          </div>
        </Panel>
        <Panel title="timing" dense>
          <KV k="created" v={timeAgo(order.createdAtMs)} />
          <KV k="deadline" v={pastDeadline ? "passed" : timeUntil(order.deadlineMs)} accent={pastDeadline ? "amber" : "phosphor"} />
          <KV
            k="receipt"
            v={
              order.receiptSubmittedAtMs === 0n
                ? "—"
                : timeAgo(order.receiptSubmittedAtMs)
            }
          />
          <KV
            k="dispute window"
            v={
              order.receiptSubmittedAtMs === 0n
                ? "—"
                : inDisputeWindow
                ? `closes ${timeUntil(BigInt(receiptWindowEndMs))}`
                : "closed"
            }
            accent={inDisputeWindow ? "amber" : "phosphor"}
          />
        </Panel>
      </section>

      {/* ============================= Lifecycle visualizer ================ */}
      <section className="mt-6">
        <Panel title="lifecycle" subtitle="state machine" accent="violet">
          <Lifecycle status={order.status} />
        </Panel>
      </section>

      {/* ============================= Spec + receipt ====================== */}
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="spec" subtitle="content-addressed at creation">
          <KV k="hash" v={<code className="break-all">{order.specHash || "—"}</code>} mono />
          <KV
            k="url"
            v={
              order.specUrl ? (
                <a
                  className="break-all hover:text-amber-bright"
                  href={order.specUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {order.specUrl}
                </a>
              ) : (
                "—"
              )
            }
          />
        </Panel>

        <Panel
          title="receipt"
          subtitle={
            order.receiptSubmittedAtMs === 0n
              ? "not yet submitted"
              : `submitted ${utcStamp(order.receiptSubmittedAtMs)}`
          }
          accent={order.receiptSubmittedAtMs === 0n ? undefined : "green"}
        >
          <KV
            k="hash"
            v={<code className="break-all">{order.receiptHash || "—"}</code>}
            mono
          />
          <KV
            k="url"
            v={
              order.receiptUrl ? (
                <a
                  className="break-all hover:text-amber-bright"
                  href={order.receiptUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {order.receiptUrl}
                </a>
              ) : (
                "—"
              )
            }
          />
        </Panel>
      </section>

      {/* ============================= Wallet actions ====================== */}
      <section className="mt-6">
        <Panel title="actions" subtitle="signed from your wallet" accent="amber">
          <WorkOrderActions order={order} />
        </Panel>
      </section>

      {/* ============================= CLI hints =========================== */}
      <section className="mt-6">
        <Panel title="next actions (CLI alternative)" dense>
          <Hints order={order} />
        </Panel>
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[10px] uppercase tracking-[0.2em] text-phosphor-faint">
        {k}
      </dt>
      <dd className="truncate text-phosphor">{v}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: WorkOrderStatusCode }) {
  switch (status) {
    case WORK_ORDER_STATUS.NEW:
      return <Tag variant="amber">NEW</Tag>;
    case WORK_ORDER_STATUS.ACCEPTED:
      return <Tag variant="violet">ACCEPTED</Tag>;
    case WORK_ORDER_STATUS.RECEIPT_SUBMITTED:
      return <Tag variant="amber">RECEIPT SUBMITTED</Tag>;
    case WORK_ORDER_STATUS.RELEASED:
      return <Tag variant="green">RELEASED</Tag>;
    case WORK_ORDER_STATUS.REFUNDED:
      return <Tag variant="neutral">REFUNDED</Tag>;
    case WORK_ORDER_STATUS.DISPUTED:
      return <Tag variant="red">DISPUTED</Tag>;
  }
}

function statusDescription(status: WorkOrderStatusCode): string {
  switch (status) {
    case WORK_ORDER_STATUS.NEW:
      return "Awaiting payee acknowledgement.";
    case WORK_ORDER_STATUS.ACCEPTED:
      return "Payee accepted; work in progress.";
    case WORK_ORDER_STATUS.RECEIPT_SUBMITTED:
      return "Payee delivered. Dispute window open.";
    case WORK_ORDER_STATUS.RELEASED:
      return "Funds routed through service-payment split.";
    case WORK_ORDER_STATUS.REFUNDED:
      return "Locked SUI returned to buyer.";
    case WORK_ORDER_STATUS.DISPUTED:
      return "Awaiting admin resolution.";
  }
}

function Lifecycle({ status }: { status: WorkOrderStatusCode }) {
  const STEPS: { code: WorkOrderStatusCode; label: string }[] = [
    { code: WORK_ORDER_STATUS.NEW, label: "new" },
    { code: WORK_ORDER_STATUS.ACCEPTED, label: "accepted" },
    { code: WORK_ORDER_STATUS.RECEIPT_SUBMITTED, label: "receipt" },
    { code: WORK_ORDER_STATUS.RELEASED, label: "released" },
  ];
  const isTerminal =
    status === WORK_ORDER_STATUS.RELEASED ||
    status === WORK_ORDER_STATUS.REFUNDED ||
    status === WORK_ORDER_STATUS.DISPUTED;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11.5px] uppercase tracking-[0.22em]">
      {STEPS.map((s, i) => {
        const reached = status >= s.code && status !== WORK_ORDER_STATUS.REFUNDED;
        return (
          <div key={s.code} className="flex items-center gap-2">
            <div
              className={`flex h-7 items-center gap-2 border px-2 ${
                status === s.code
                  ? "border-amber-bright/80 bg-amber/10 text-amber-bright"
                  : reached
                  ? "border-green-dim/70 bg-green/5 text-green-bright"
                  : "border-border text-phosphor-faint"
              }`}
            >
              <span className="text-[10px]">0{i + 1}</span>
              <span>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="text-phosphor-faint">→</span>
            )}
          </div>
        );
      })}
      {status === WORK_ORDER_STATUS.REFUNDED && (
        <div className="ml-2 flex h-7 items-center border border-border-bright bg-surface-2/50 px-2 text-phosphor">
          → refunded
        </div>
      )}
      {status === WORK_ORDER_STATUS.DISPUTED && (
        <div className="ml-2 flex h-7 items-center border border-red/60 bg-red/5 px-2 text-red-bright">
          → disputed
        </div>
      )}
      {!isTerminal && (
        <span className="ml-3 text-[10px] text-phosphor-faint">
          terminal states: released · refunded · disputed
        </span>
      )}
    </div>
  );
}

function Hints({ order }: { order: WorkOrderView }) {
  const s = order.status;
  const coin = order.coinType;
  const id = order.objectId;
  let hints: { who: string; cmd: string; explain: string }[] = [];
  if (s === WORK_ORDER_STATUS.NEW) {
    hints = [
      {
        who: "payee",
        cmd: `tai work accept --id ${id} --coin-type "${coin}" --owner-cap <OWNER_CAP_ID>`,
        explain: "Acknowledge the order with the payee's OwnerCap or OperatorCap.",
      },
      {
        who: "buyer (after deadline)",
        cmd: `tai work refund --id ${id} --coin-type "${coin}"`,
        explain: "If the payee never accepts before the deadline, reclaim locked SUI.",
      },
    ];
  } else if (s === WORK_ORDER_STATUS.ACCEPTED) {
    hints = [
      {
        who: "payee",
        cmd: `tai work submit-receipt --id ${id} --coin-type "${coin}" --owner-cap <CAP_ID> --receipt-hash <HEX> --receipt-url <URL>`,
        explain: "Deliver work — submit a content-addressed receipt.",
      },
      {
        who: "buyer (after deadline)",
        cmd: `tai work refund --id ${id} --coin-type "${coin}"`,
        explain: "Refund eligible if no receipt is submitted by the deadline.",
      },
    ];
  } else if (s === WORK_ORDER_STATUS.RECEIPT_SUBMITTED) {
    hints = [
      {
        who: "buyer",
        cmd: `tai work release --id ${id} --coin-type "${coin}" --payee-account ${order.payeeLaunchpadAccountId}`,
        explain: "Confirm delivery — routes locked SUI through service-payment.",
      },
      {
        who: "buyer (dispute)",
        cmd: `tai work dispute --id ${id} --coin-type "${coin}"`,
        explain: "Open a dispute during the window; admin resolves.",
      },
      {
        who: "anyone (after window)",
        cmd: `tai work release --id ${id} --coin-type "${coin}" --payee-account ${order.payeeLaunchpadAccountId}`,
        explain: "Anyone may finalize once the dispute window closes.",
      },
    ];
  } else if (s === WORK_ORDER_STATUS.DISPUTED) {
    hints = [
      {
        who: "admin",
        cmd: `# admin_resolve_dispute via PTB or scripted call`,
        explain: "Admin resolves: release to payee or refund buyer.",
      },
    ];
  } else {
    return (
      <p className="text-[12.5px] text-phosphor-dim">
        Terminal state — no further actions.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {hints.map((h, i) => (
        <li key={i}>
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-phosphor-faint">
            {h.who}
          </div>
          <code className="mt-1 block overflow-x-auto whitespace-pre border border-border-bright bg-base px-2 py-1.5 text-[12px] text-amber-bright">
            {h.cmd}
          </code>
          <div className="mt-1 text-[11.5px] text-phosphor-dim">{h.explain}</div>
        </li>
      ))}
    </ul>
  );
}

function timeUntil(targetMs: bigint | number, nowMs = Date.now()): string {
  const tm = typeof targetMs === "bigint" ? Number(targetMs) : targetMs;
  const delta = tm - nowMs;
  if (delta <= 0) return "passed";
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (delta < m) return `${Math.floor(delta / 1000)}s`;
  if (delta < h) return `${Math.floor(delta / m)}m`;
  if (delta < d) return `${Math.floor(delta / h)}h`;
  return `${Math.floor(delta / d)}d`;
}
