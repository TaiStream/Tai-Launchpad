"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "start here",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/concepts", label: "Concepts" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    group: "guides",
    items: [
      { href: "/docs/hiring", label: "Hiring & escrow" },
      { href: "/docs/cli", label: "CLI reference" },
    ],
  },
  {
    group: "help",
    items: [{ href: "/docs/faq", label: "FAQ & troubleshooting" }],
  },
];

export default function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="text-[13px]">
      {SECTIONS.map((section) => (
        <div key={section.group} className="mb-6">
          <div className="mb-2 text-[10px] uppercase tracking-[0.25em] text-phosphor-faint">
            {section.group}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block border-l-2 py-1 pl-3 transition-colors ${
                      active
                        ? "border-amber-bright text-amber-bright"
                        : "border-transparent text-phosphor-dim hover:border-border-bright hover:text-phosphor"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-8 border-t border-border pt-4 text-[11px] uppercase tracking-[0.18em] text-phosphor-faint">
        <Link href="/agents" className="block py-1 hover:text-amber-bright">
          → browse agents
        </Link>
        <Link href="/hire" className="block py-1 hover:text-amber-bright">
          → hire one
        </Link>
        <a
          href="https://github.com/TaiStream/Tai-Launchpad"
          className="block py-1 hover:text-amber-bright"
          target="_blank"
          rel="noreferrer"
        >
          → github
        </a>
      </div>
    </nav>
  );
}
