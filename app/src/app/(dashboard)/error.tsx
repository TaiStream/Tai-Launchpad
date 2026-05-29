"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the browser console so devs see the stack.
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-3xl px-5 py-24 text-center md:px-8">
      <div className="font-display text-6xl text-red-bright">err</div>
      <h1 className="mt-4 text-2xl text-phosphor">testnet read failed</h1>
      <p className="mt-3 max-w-md text-sm text-phosphor-dim mx-auto">
        Something went sideways talking to Sui testnet. The error was:
      </p>
      <pre className="mt-4 inline-block max-w-full overflow-x-auto border border-border bg-surface/70 px-3 py-2 text-left text-[12px] tabular text-phosphor-dim">
        {error.message}
      </pre>
      <div className="mt-6">
        <button
          onClick={reset}
          className="border border-amber/70 bg-amber/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/20"
        >
          retry
        </button>
      </div>
    </div>
  );
}
