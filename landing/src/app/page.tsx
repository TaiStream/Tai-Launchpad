import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Wedge from "@/components/Wedge";
import Primitives from "@/components/Primitives";
import CliSurface from "@/components/CliSurface";
import Modes from "@/components/Modes";
import Architecture from "@/components/Architecture";
import Roadmap from "@/components/Roadmap";
import GetStarted from "@/components/GetStarted";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Wedge />
        <Primitives />
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
