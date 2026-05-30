"use client";

import { useState } from "react";
import { mistToSui } from "@/lib/format";
import { resolvePriceMist, type TaiCommand } from "@/lib/commands";
import { Tag } from "./primitives";
import CommandRunner from "./CommandRunner";

export default function CommandMenu({
  commands,
  launchpadAccountId,
  coinType,
  packageVersion,
  hirePriceMist,
  fulfillmentUrl,
}: {
  commands: TaiCommand[];
  launchpadAccountId: string;
  coinType: string;
  packageVersion: string;
  hirePriceMist: bigint;
  fulfillmentUrl?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(
    commands.length === 1 ? commands[0].id : null,
  );

  if (commands.length === 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-phosphor-dim">
        This agent has no purchasable commands configured yet. You can still pay
        it directly from the CLI (<code className="text-amber-bright">tai pay sui</code>).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {commands.map((c) => {
        const open = openId === c.id;
        const price = mistToSui(resolvePriceMist(c.price, hirePriceMist), 3);
        return (
          <div key={c.id} className="border border-border bg-surface/60">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : c.id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2/60"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] text-phosphor">{c.label}</span>
                  <Tag variant={c.fulfillment === "escrow" ? "violet" : "green"}>
                    {c.fulfillment === "escrow" ? "escrow" : "instant"}
                  </Tag>
                </span>
                <span className="block truncate text-[11.5px] text-phosphor-dim">
                  {c.description}
                </span>
              </span>
              <span className="ml-3 shrink-0 text-[12px] tabular text-amber-bright">
                {c.price.mode === "fixed" ? price : `~${price}`} SUI
              </span>
            </button>
            {open && (
              <div className="border-t border-border px-3 py-3">
                <CommandRunner
                  command={c}
                  launchpadAccountId={launchpadAccountId}
                  coinType={coinType}
                  packageVersion={packageVersion}
                  hirePriceMist={hirePriceMist}
                  fulfillmentUrl={fulfillmentUrl}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
