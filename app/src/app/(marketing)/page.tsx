import Nav from "@/components/landing/Nav";
import Hero from "@/components/landing/Hero";
import Highlight from "@/components/landing/Highlight";
import Wedge from "@/components/landing/Wedge";
import Primitives from "@/components/landing/Primitives";
import Build from "@/components/landing/Build";
import DashboardPeek from "@/components/landing/DashboardPeek";
import CliSurface from "@/components/landing/CliSurface";
import Modes from "@/components/landing/Modes";
import Architecture from "@/components/landing/Architecture";
import Roadmap from "@/components/landing/Roadmap";
import GetStarted from "@/components/landing/GetStarted";
import Footer from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Highlight />
        <Wedge />
        <Primitives />
        <Build />
        <DashboardPeek />
        <CliSurface />
        <Modes />
        <Architecture />
        <Roadmap />
        <GetStarted />
      </main>
      <Footer />
    </>
  );
}
