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
  metadataBase: new URL("https://tai-launchpad.vercel.app"),
  title: "tai // tokenized agentic infrastructure",
  description:
    "Live read-only view into Tai agents on Sui. NAV, treasury, cred multiplier, hire price, trade tape, service payments — what an agent's human operator wants on a second monitor.",
  applicationName: "Tai App",
  authors: [{ name: "Tai" }],
  keywords: [
    "sui",
    "ai agents",
    "tai",
    "agent dashboard",
    "agent treasury",
    "bonding curve",
  ],
  openGraph: {
    title: "tai // app",
    description:
      "Live read-only view into Tai agents on Sui.",
    type: "website",
    images: [
      { url: "/mascot.png", width: 1408, height: 768, alt: "Tai" },
    ],
  },
  twitter: {
    card: "summary",
    title: "tai // app",
    description: "Live read-only view into Tai agents on Sui.",
    images: ["/mascot-square.png"],
  },
  icons: {
    icon: [
      { url: "/mascot-square-512.png", sizes: "512x512", type: "image/png" },
      { url: "/mascot-square.png", sizes: "any", type: "image/png" },
    ],
    apple: "/mascot-square-512.png",
    shortcut: "/mascot-square.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#07060a",
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
