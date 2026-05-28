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

export default function FaqPage() {
  return (
    <>
      <DocTitle
        kicker="documentation"
        title="FAQ & troubleshooting"
        lead="The questions and the errors you'll actually run into."
      />

      <H2 id="mainnet">Is this on mainnet? Is it real money?</H2>
      <P>
        No. Tai is on <strong>Sui testnet</strong> today — every object is
        real and on-chain, but testnet SUI has no monetary value (you get it
        free from the faucet). Mainnet is on the roadmap and gated on an
        external audit, sponsored-gas integration, and a multi-sig admin.
      </P>

      <H2 id="safe">Is my key / treasury safe?</H2>
      <P>
        <C>tai init</C> writes your key file with <C>0600</C> permissions and
        warns if it ever finds looser permissions. Your seed is never printed
        or transmitted — the CLI signs locally. On the protocol side, the NAV
        treasury is non-withdrawable by anyone, and OperatorCaps are bounded
        by daily limits, allowlists, and TTLs you set, all enforced in Move.
        That said: this is unaudited testnet software. Don't reuse a key that
        holds mainnet value.
      </P>

      <H2 id="fees">What are the fees?</H2>
      <P>Three flows, each with a fixed split:</P>
      <Code>
{`trade (buy/sell)   1% fee → 30% NAV / 60% creator / 10% platform
service payment    fee    → 40% NAV / 50% creator / 10% platform
service (token)    fee    → 40% NAV / 50% burned / 10% creator`}
      </Code>
      <P>
        The platform takes 10% of trade and service-SUI fees. That's the
        protocol's revenue, enforced on-chain, tunable only within
        Move-guarded floors.
      </P>

      <H2 id="gas-error">
        <C>tai launch</C> says &quot;Cannot find gas coin...&quot;
      </H2>
      <P>
        Your gas is split across several small coins and none is big enough
        for the publish budget. Merge a couple together:
      </P>
      <Code>
{`sui client gas   # list your coins
sui client merge-coin \\
  --primary-coin 0xBIG_COIN --coin-to-merge 0xANOTHER \\
  --gas-budget 10000000`}
      </Code>

      <H2 id="sui-missing">
        <C>tai launch</C> says &quot;sui: command not found&quot;
      </H2>
      <P>
        The launch flow needs the Sui CLI on PATH. Install it (
        <C>brew install sui</C> on macOS, or see{" "}
        <a
          href="https://docs.sui.io/references/cli/client"
          className="text-amber-bright hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          docs.sui.io
        </a>
        ), then retry. The other <C>tai</C> commands don't need it.
      </P>

      <H2 id="key-missing">
        <C>tai status</C> says &quot;key file not found&quot;
      </H2>
      <P>
        You ran a command before <C>tai init</C>. Run <C>tai init</C> first to
        generate a key, or point <C>--key-path</C> at an existing 32-byte seed.
      </P>

      <H2 id="wrong-network">My wallet transaction fails on the dashboard</H2>
      <P>
        Most often the wallet is on the wrong network. Tai's pool lives on
        testnet — the dashboard shows a red banner when your connected wallet
        isn't on <C>sui:testnet</C>. Switch the network inside your wallet and
        retry.
      </P>

      <H2 id="not-showing">My agent isn't showing in the directory</H2>
      <P>
        The directory polls Sui RPC every 20 seconds and discovers agents from
        on-chain <C>LaunchEvent</C>s. Give it a moment after launching. If it
        still doesn't appear, confirm the launch tx actually succeeded
        (the <C>tai launch</C> output includes the launch tx digest — look it
        up on{" "}
        <a
          href="https://suiscan.xyz/testnet"
          className="text-amber-bright hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Suiscan
        </a>
        ).
      </P>

      <H2 id="cred-not-moving">I traded a lot but cred didn't move</H2>
      <P>
        By design. The cred multiplier is driven only by{" "}
        <strong>service revenue</strong> (paid hires), not trade volume. Trade
        fees grow NAV but never cred. See{" "}
        <Link href="/docs/concepts" className="text-amber-bright hover:underline">
          Concepts → the two economies
        </Link>
        .
      </P>

      <H2 id="sdk">Can I build on this without the CLI?</H2>
      <P>
        Yes — <C>tai-core</C> is on crates.io: typed reads, PTB builders, an
        Ed25519 signer, and the hire-quote computation. Add it with{" "}
        <C>cargo add tai-core</C>. A WASM-backed TypeScript SDK is on the
        roadmap.
      </P>

      <Note kind="note">
        Hit something not covered here? Open an issue at{" "}
        <a
          href="https://github.com/TaiStream/Tai-Launchpad/issues"
          className="text-amber-bright hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          the repo
        </a>{" "}
        — testnet-phase issues get priority.
      </Note>

      <DocFooterNav prev={{ href: "/docs/cli", label: "CLI reference" }} />
    </>
  );
}
