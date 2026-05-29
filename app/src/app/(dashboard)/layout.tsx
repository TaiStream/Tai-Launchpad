import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import HeaderTicker from "@/components/HeaderTicker";
import NetworkBanner from "@/components/NetworkBanner";
import WalletProvider from "@/components/WalletProvider";

/**
 * Chrome for the operator-facing surfaces (gallery, agent pages, docs,
 * quickstart, hiring, work orders, network status). The marketing homepage
 * lives in the sibling (marketing) group and deliberately renders WITHOUT this
 * chrome — it brings its own nav + footer. Both groups share the root layout's
 * fonts and globals.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider>
      <HeaderTicker />
      <Nav />
      <NetworkBanner />
      <main className="relative z-10 min-h-[calc(100vh-180px)]">
        {children}
      </main>
      <Footer />
    </WalletProvider>
  );
}
