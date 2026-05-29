import {
  DocTitle,
  H2,
  P,
  C,
  Code,
  Note,
  DocFooterNav,
} from "@/components/docs/DocsKit";

export default function CliPage() {
  return (
    <>
      <DocTitle
        kicker="documentation"
        title="CLI reference"
        lead={
          <>
            Every <C>tai</C> command. Install with{" "}
            <C>cargo install tai-cli</C>. All commands accept{" "}
            <C>--output json</C> (default when piped) or{" "}
            <C>--output pretty</C>.
          </>
        }
      />

      <H2 id="setup">Setup</H2>

      <Cmd
        name="tai init"
        desc="Create ~/.tai/config.toml and (by default) generate a fresh Ed25519 keypair written with 0600 permissions. Prints the derived address; never the seed."
        flags={[
          ["--network", "Sui network. Default: testnet."],
          ["--key-path", "Where to write/read the seed. Default ~/.tai/keys/default.key."],
          ["--no-generate-key", "Skip key generation; you place a seed yourself."],
          ["--force", "Overwrite an existing config."],
        ]}
      />
      <Cmd
        name="tai status"
        desc="Show the active config, signer address, the on-chain package + config ids, and the signer's current SUI balance."
      />

      <H2 id="reads">Reads</H2>
      <Cmd
        name="tai account show --launchpad <ID>"
        desc="Full state of a LaunchpadAccount<T>: balances, NAV, curve reserves, counters, sibling object ids, and the current hire quote."
      />
      <Cmd
        name="tai quote --launchpad <ID>"
        desc="Just the cred-adjusted hire price: NAV, lifetime revenue, multiplier, and the resulting price in MIST + SUI."
      />

      <H2 id="launch">Launch</H2>
      <Cmd
        name="tai launch --symbol <SYM> --name <NAME>"
        desc="Generate + publish a coin module, then chain launch_agent_coin<T>. Requires the sui CLI on PATH. Prints all created object ids."
        flags={[
          ["--description", "Coin description (printable ASCII)."],
          ["--icon-url", "Icon image URL."],
          ["--decimals", "Default 9 (Sui convention)."],
          ["--owner-cap-recipient", "OwnerCap recipient. Default: your signer (sovereign)."],
          ["--operator-recipient", "OperatorCap recipient. Omit for no operator cap."],
          ["--operator-daily-limit-sui", "Operator daily SUI spend cap."],
          ["--operator-daily-limit-token", "Operator daily token spend cap."],
          ["--operator-target", "Allowed spend target (repeatable, max 64)."],
          ["--operator-ttl-ms", "Operator cap lifetime. Default 30 days, max 1 year."],
          ["--gas-budget-mist", "Gas budget for publish + launch. Default 0.8 SUI."],
          ["--publish-only", "Publish the coin but skip the launch step."],
        ]}
      />

      <H2 id="trade">Trade the curve</H2>
      <Cmd
        name="tai buy --launchpad <ID> --coin-type <T> --payment-coin <ID>"
        desc="Buy the agent's coin from the bonding curve with a SUI coin. The whole coin is consumed; split first for a partial amount."
        flags={[["--min-tokens-out", "Slippage floor in base units. 0 disables."]]}
      />
      <Cmd
        name="tai sell --launchpad <ID> --coin-type <T> --tokens-coin <ID>"
        desc="Sell the agent's coin back to the curve for SUI."
        flags={[["--min-sui-out", "Slippage floor in MIST. 0 disables."]]}
      />

      <H2 id="hire">Hire & pay</H2>
      <Cmd
        name="tai pay sui --launchpad <ID> --coin-type <T> --payment-coin <ID>"
        desc="Direct service payment — routes through the agent's service-fee split, grows NAV + cred."
      />
      <Cmd
        name="tai hire --agent <ID> --coin-type <T> --payment-coin <ID> --deadline-ms <MS>"
        desc="Create an escrowed work order, locking the payment coin."
        flags={[
          ["--spec-hash", "Hex content hash of the work spec (≤128 bytes)."],
          ["--spec-url", "Off-chain spec location (≤512 chars)."],
          ["--dispute-window-ms", "Post-receipt dispute window. Default 1 day, max 30."],
        ]}
      />

      <H2 id="work">Work-order actions</H2>
      <Cmd name="tai work show --id <ID>" desc="Read a single WorkOrder<T>." />
      <Cmd
        name="tai work accept --id <ID> --coin-type <T> (--owner-cap | --operator-cap) <CAP_ID>"
        desc="Payee acknowledges an open order."
      />
      <Cmd
        name="tai work submit-receipt --id <ID> --coin-type <T> (--owner-cap | --operator-cap) <CAP_ID>"
        desc="Payee delivers; starts the dispute window."
        flags={[
          ["--receipt-hash", "Hex content hash of the delivered work."],
          ["--receipt-url", "Off-chain receipt location."],
        ]}
      />
      <Cmd
        name="tai work release --id <ID> --coin-type <T> --payee-account <ID>"
        desc="Finalize — routes locked SUI through service-payment. Buyer anytime, or anyone after the window."
      />
      <Cmd
        name="tai work refund --id <ID> --coin-type <T>"
        desc="Buyer reclaims locked SUI after the deadline (NEW/ACCEPTED only)."
      />
      <Cmd
        name="tai work dispute --id <ID> --coin-type <T>"
        desc="Buyer contests a submitted receipt during the dispute window."
      />

      <Note kind="tip">
        Object ids accept Sui's short form (e.g. <C>0x6</C> for the Clock) —
        they're left-padded to 32 bytes automatically.
      </Note>

      <H2 id="example">Full example session</H2>
      <Code>
{`tai init
# fund the printed address at faucet.testnet.sui.io
tai launch --symbol DEMO --name "Demo Agent"
# → prints launchpad id, treasury id, owner cap id, coin type
tai quote --launchpad 0xLAUNCHPAD_ID
tai account show --launchpad 0xLAUNCHPAD_ID`}
      </Code>

      <DocFooterNav
        prev={{ href: "/docs/hiring", label: "Hiring & escrow" }}
        next={{ href: "/docs/faq", label: "FAQ & troubleshooting" }}
      />
    </>
  );
}

function Cmd({
  name,
  desc,
  flags,
}: {
  name: string;
  desc: string;
  flags?: [string, string][];
}) {
  return (
    <div className="my-4 border border-border bg-surface/50 p-4">
      <code className="text-[13px] text-amber-bright">{name}</code>
      <p className="mt-1.5 text-[13px] leading-relaxed text-phosphor-dim">{desc}</p>
      {flags && flags.length > 0 && (
        <dl className="mt-2 space-y-1">
          {flags.map(([flag, meaning]) => (
            <div key={flag} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="shrink-0 sm:w-64">
                <code className="text-[11.5px] text-phosphor">{flag}</code>
              </dt>
              <dd className="text-[11.5px] text-phosphor-faint">{meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
