//! `tai` — the command-line interface to the Tai launchpad.
//!
//! ```text
//! tai init [--non-interactive] [--network testnet] [--signer-mode ed25519] [--key-path PATH]
//! tai status
//! tai account show --launchpad <ID>
//! tai quote --launchpad <ID>
//! tai pay sui --launchpad <ID> --coin-type <T> --payment-coin <ID>
//! ```
//!
//! Output mode defaults to JSON when piped, indented JSON when stdout is a
//! TTY. Override with `--output {json,pretty,auto}`. Every command emits
//! a serializable struct so the output is grep/jq-friendly in both modes.

mod commands;
mod config;
mod output;

use clap::{Parser, Subcommand};
use commands::{AccountShowArgs, InitArgs, PaySuiArgs, QuoteArgs};
use output::OutputMode;

#[derive(Parser, Debug)]
#[command(
    name = "tai",
    version,
    about = "Tai — Sui-native tokenized agentic infrastructure",
    long_about = None,
)]
struct Cli {
    /// Output format. Defaults to JSON when piped, pretty when TTY.
    #[arg(long, value_enum, global = true, default_value_t = OutputMode::Auto)]
    output: OutputMode,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Write `~/.tai/config.toml` with the selected network + signer.
    Init(InitArgs),

    /// Show current config + active signer address + SUI balance on the
    /// configured network.
    Status,

    /// Read a Tai object on-chain.
    #[command(subcommand)]
    Account(AccountCommand),

    /// Read the cred-adjusted hire price for an agent.
    Quote(QuoteArgs),

    /// Pay an agent for a service. See subcommands.
    #[command(subcommand)]
    Pay(PayCommand),
}

#[derive(Subcommand, Debug)]
enum AccountCommand {
    /// Show all fields of a LaunchpadAccount<T> + its AgentTreasury + the
    /// current hire quote.
    Show(AccountShowArgs),
}

#[derive(Subcommand, Debug)]
enum PayCommand {
    /// Submit `record_service_payment_sui` on behalf of the configured
    /// signer. Routes the SUI coin through the agent's service-fee split.
    Sui(PaySuiArgs),
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Init(args) => commands::cmd_init(args, cli.output),
        Command::Status => commands::cmd_status(cli.output).await,
        Command::Account(AccountCommand::Show(args)) => {
            commands::cmd_account_show(args, cli.output).await
        }
        Command::Quote(args) => commands::cmd_quote(args, cli.output).await,
        Command::Pay(PayCommand::Sui(args)) => commands::cmd_pay_sui(args, cli.output).await,
    }
}
