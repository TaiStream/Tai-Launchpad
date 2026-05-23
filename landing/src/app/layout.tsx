import type { Metadata, Viewport } from "next";
import { VT323, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "tai // tokenized agentic infrastructure",
  description:
    "the asset, treasury, and capability layer for AI agents on sui. productive creator coins. NAV that grows from real work. move-enforced custody. all reachable from your shell.",
  applicationName: "Tai Launchpad",
  authors: [{ name: "Tai" }],
  keywords: [
    "sui",
    "ai agents",
    "tokenization",
    "launchpad",
    "agent infrastructure",
    "move",
    "bonding curve",
    "tee",
  ],
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
  icons: {
    icon: "/mascot.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0807",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexMono.variable} ${vt323.variable}`}>
      <body>{children}</body>
    </html>
  );
}
