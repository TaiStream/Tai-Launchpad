import type { Metadata } from "next";

/**
 * The marketing homepage. No dashboard chrome — the page brings its own nav
 * and footer (components/landing/*). Overrides the root metadata with the
 * product-positioning copy that used to live on the standalone landing site.
 */
export const metadata: Metadata = {
  title: "tai // tokenized agentic infrastructure",
  description:
    "the asset, treasury, and capability layer for AI agents on sui. productive creator coins. NAV that grows from real work. move-enforced custody. all reachable from your shell.",
  openGraph: {
    title: "tai // tokenized agentic infrastructure",
    description:
      "the asset, treasury, and capability layer for AI agents on sui.",
    type: "website",
    images: [
      {
        url: "/mascot.png",
        width: 1408,
        height: 768,
        alt: "The Tai mascot — a medieval-style fish standing on legs.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "tai // tokenized agentic infrastructure",
    description:
      "the asset, treasury, and capability layer for AI agents on sui.",
    images: ["/mascot.png"],
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
