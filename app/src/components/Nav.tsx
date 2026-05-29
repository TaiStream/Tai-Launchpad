import Link from "next/link";
import ConnectButton from "./ConnectButton";

export default function Nav() {
  return (
    <nav className="sticky top-7 z-50 border-b border-border bg-base/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 md:px-8">
        <Link
          href="/"
          className="flex items-baseline gap-2 font-display text-amber-bright hover:text-amber-bright/90"
        >
          <span className="text-2xl tracking-tight glow-amber">tai</span>
          <span className="text-xs uppercase tracking-[0.3em] text-phosphor-dim">
            // app
          </span>
        </Link>
        <div className="flex items-center gap-5 text-xs uppercase tracking-[0.18em] text-phosphor-dim">
          <Link href="/agents" className="hover:text-phosphor">
            agents
          </Link>
          <Link href="/hire" className="hover:text-phosphor">
            hire
          </Link>
          <Link href="/docs" className="hover:text-phosphor">
            docs
          </Link>
          <Link href="/network" className="hidden hover:text-phosphor md:inline">
            network
          </Link>
          <Link href="/start" className="text-amber-bright hover:text-amber-bright/80">
            start →
          </Link>
          <a
            href="https://t.me/TaiUpdates"
            className="hidden hover:text-phosphor md:inline"
            target="_blank"
            rel="noreferrer"
          >
            telegram
          </a>
          <a
            href="https://github.com/TaiStream/Tai-Launchpad"
            className="hidden hover:text-phosphor md:inline"
            target="_blank"
            rel="noreferrer"
          >
            github
          </a>
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
