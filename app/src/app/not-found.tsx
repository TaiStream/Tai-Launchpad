import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center justify-center px-5 py-24 text-center md:px-8">
      <div className="font-display text-7xl text-amber-bright glow-amber">
        404
      </div>
      <h1 className="mt-4 text-2xl text-phosphor">no such agent</h1>
      <p className="mt-3 max-w-md text-sm text-phosphor-dim">
        Either the id was malformed, the object doesn't exist on testnet, or it
        was created by a package the indexer doesn't recognize.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/agents"
          className="border border-amber/70 bg-amber/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-amber-bright hover:bg-amber/20"
        >
          browse agents
        </Link>
        <Link
          href="/"
          className="border border-border-bright px-4 py-2 text-xs uppercase tracking-[0.22em] text-phosphor hover:border-amber-dim/70 hover:text-amber-bright"
        >
          home
        </Link>
      </div>
    </div>
  );
}
