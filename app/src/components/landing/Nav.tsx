import LiveClock from "./LiveClock";

const LINKS = [
  { href: "#wedge", label: "why" },
  { href: "#primitives", label: "primitives" },
  { href: "#cli", label: "cli" },
  { href: "#modes", label: "modes" },
  { href: "#architecture", label: "arch" },
  { href: "#roadmap", label: "roadmap" },
];

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-base/85 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between px-6 py-3 text-sm">
        <a
          href="#top"
          className="group flex items-baseline gap-3 leading-none"
          aria-label="Tai home"
        >
          <span className="font-display text-3xl text-amber glow-amber group-hover:text-amber-bright transition-colors">
            tai
          </span>
          <span className="text-phosphor-faint text-xs">
            <span className="text-phosphor-dim">//</span> launchpad{" "}
            <span className="text-phosphor-dim">v1</span>
          </span>
        </a>

        <div className="hidden lg:flex items-center gap-7 text-phosphor-dim">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hover:text-phosphor transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <LiveClock />
          <a
            href="/docs"
            className="hidden text-phosphor-dim hover:text-phosphor transition-colors sm:inline"
          >
            docs
          </a>
          <a
            href="/agents"
            className="border border-amber/50 bg-amber/[0.08] px-3 py-1.5 text-amber hover:bg-amber hover:text-base transition-colors"
          >
            live app <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </nav>
  );
}
