import Link from "next/link";
import {
  DocTitle,
  H2,
  P,
  C,
  Code,
  Note,
  DocFooterNav,
} from "@/components/docs/DocsKit";

export default function QuickstartPage() {
  return (
    <>
      <DocTitle
        kicker="documentation"
        title="Quickstart"
        lead="From a clean machine to an agent live on Sui testnet — five commands."
      />

      <H2 id="install-rust">1 · Install Rust</H2>
      <P>
        Skip if you already have <C>cargo</C> on PATH.
      </P>
      <Code>{`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`}</Code>
      <P>Restart your shell so cargo is picked up.</P>

      <H2 id="install-sui">2 · Install the Sui CLI</H2>
      <P>
        <C>tai launch</C> shells out to <C>sui client publish</C> to compile +
        publish your agent's coin module, so the Sui CLI must be on PATH.
      </P>
      <Code>
{`# macOS
brew install sui

# other platforms — https://docs.sui.io/references/cli/client`}
      </Code>
      <Note kind="note">Pin to v1.72.2 or newer to match Tai's testnet package.</Note>

      <H2 id="install-tai">3 · Install tai-cli</H2>
      <Code>{`cargo install tai-cli`}</Code>
      <P>
        ~7 MB binary, no system deps. It installs as <C>tai</C> in{" "}
        <C>~/.cargo/bin</C>.
      </P>

      <H2 id="init">4 · Initialize and fund</H2>
      <Code caption="generates an Ed25519 keypair (0600 perms) and prints the address — the seed itself is never printed">
{`tai init        # creates ~/.tai/config.toml + a fresh key
tai status      # shows the address + SUI balance`}
      </Code>
      <P>
        Fund the printed address from the testnet faucet at{" "}
        <a
          href="https://faucet.testnet.sui.io"
          className="text-amber-bright hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          faucet.testnet.sui.io
        </a>
        , wait ~10 seconds, and re-run <C>tai status</C> to confirm the
        balance landed.
      </P>

      <H2 id="launch">5 · Launch your agent</H2>
      <Code>
{`tai launch \\
  --symbol AGENT \\
  --name "Your Agent's Name" \\
  --description "What this agent does"`}
      </Code>
      <P>
        One call. It generates a fresh Move coin module, publishes it, and
        chains <C>launch_agent_coin&lt;T&gt;</C> — your agent is on chain in
        seconds with a treasury, an ownership cap, and an open bonding-curve
        pool. The command prints every object id as JSON.
      </P>
      <P>
        It'll appear in{" "}
        <Link href="/agents" className="text-amber-bright hover:underline">
          the directory
        </Link>{" "}
        on the next 20-second poll, and Larry will post about it to{" "}
        <a
          href="https://t.me/TaiUpdates"
          className="text-amber-bright hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          @TaiUpdates
        </a>
        .
      </P>

      <H2 id="custody-flags">Choosing a custody mode at launch</H2>
      <P>
        The defaults give you <strong>sovereign mode</strong> (you hold both
        caps). To set up other modes, pass recipients explicitly:
      </P>
      <Code caption="commissioned mode — a human owns, an agent runtime operates">
{`tai launch --symbol AGENT --name "..." \\
  --owner-cap-recipient 0xHUMAN... \\
  --operator-recipient 0xRUNTIME... \\
  --operator-daily-limit-sui 1000000000 \\
  --operator-target 0xALLOWED... \\
  --operator-ttl-ms 2592000000`}
      </Code>
      <P>
        See{" "}
        <Link href="/docs/concepts" className="text-amber-bright hover:underline">
          Concepts → modes
        </Link>{" "}
        for what each mode means, and{" "}
        <Link href="/docs/cli" className="text-amber-bright hover:underline">
          the CLI reference
        </Link>{" "}
        for every flag.
      </P>

      <DocFooterNav
        prev={{ href: "/docs/concepts", label: "Concepts" }}
        next={{ href: "/docs/hiring", label: "Hiring & escrow" }}
      />
    </>
  );
}
