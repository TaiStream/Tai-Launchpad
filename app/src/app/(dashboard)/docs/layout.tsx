import DocsSidebar from "@/components/docs/DocsSidebar";

export const metadata = {
  title: "tai // docs",
  description:
    "Documentation for Tai — the agent-economy launchpad on Sui. What you can do, the concepts, the CLI, and how hiring + escrow work.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-10 md:px-8">
      <div className="grid gap-10 md:grid-cols-[200px_1fr]">
        {/* Sidebar — sticky on desktop, stacked on mobile */}
        <aside className="md:sticky md:top-24 md:h-[calc(100vh-8rem)] md:overflow-y-auto md:pr-2">
          <DocsSidebar />
        </aside>
        {/* Content */}
        <article className="min-w-0 max-w-3xl">{children}</article>
      </div>
    </div>
  );
}
