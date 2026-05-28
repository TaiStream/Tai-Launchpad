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
mod launch;
mod output;

use clap::{Parser, Subcommand};
use commands::{
    AccountShowArgs, BuyArgs, HireArgs, InitArgs, LaunchArgs, PaySuiArgs, QuoteArgs, SellArgs,
    WorkAcceptArgs, WorkDisputeArgs, WorkRefundArgs, WorkReleaseArgs, WorkShowArgs,
    WorkSubmitReceiptArgs,
};
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

    /// Generate + publish a fresh coin module for an agent, then chain
    /// `launch_agent_coin<T>` to create the LaunchpadAccount + treasury +
    /// caps in one flow. Requires `sui` CLI on PATH.
    Launch(LaunchArgs),

    /// Buy an agent's coin from the bonding curve. SUI in → tokens out.
    Buy(BuyArgs),

    /// Sell an agent's coin back to the bonding curve. Tokens in → SUI out.
    Sell(SellArgs),

    /// Hire an agent with a work-order escrow.
    Hire(HireArgs),

    /// Work-order operations. See subcommands.
    #[command(subcommand)]
    Work(WorkCommand),
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

#[derive(Subcommand, Debug)]
enum WorkCommand {
    /// Read a single WorkOrder<T> by id.
    Show(WorkShowArgs),
    /// Payee accepts an open work order using their OwnerCap or OperatorCap.
    Accept(WorkAcceptArgs),
    /// Payee submits the receipt that closes their side of the order.
    SubmitReceipt(WorkSubmitReceiptArgs),
    /// Buyer or anyone-after-window finalizes — funds route via service-payment.
    Release(WorkReleaseArgs),
    /// Buyer reclaims locked funds after deadline (NEW or ACCEPTED only).
    Refund(WorkRefundArgs),
    /// Buyer opens a dispute during the post-receipt window. Admin resolves.
    Dispute(WorkDisputeArgs),
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
        Command::Init(args) => commands::cmd_init(args, cli.output).await,
        Command::Status => commands::cmd_status(cli.output).await,
        Command::Account(AccountCommand::Show(args)) => {
            commands::cmd_account_show(args, cli.output).await
        }
        Command::Quote(args) => commands::cmd_quote(args, cli.output).await,
        Command::Pay(PayCommand::Sui(args)) => commands::cmd_pay_sui(args, cli.output).await,
        Command::Launch(args) => commands::cmd_launch(args, cli.output).await,
        Command::Buy(args) => commands::cmd_buy(args, cli.output).await,
        Command::Sell(args) => commands::cmd_sell(args, cli.output).await,
        Command::Hire(args) => commands::cmd_hire(args, cli.output).await,
        Command::Work(WorkCommand::Show(args)) => commands::cmd_work_show(args, cli.output).await,
        Command::Work(WorkCommand::Accept(args)) => {
            commands::cmd_work_accept(args, cli.output).await
        }
        Command::Work(WorkCommand::SubmitReceipt(args)) => {
            commands::cmd_work_submit_receipt(args, cli.output).await
        }
        Command::Work(WorkCommand::Release(args)) => {
            commands::cmd_work_release(args, cli.output).await
        }
        Command::Work(WorkCommand::Refund(args)) => {
            commands::cmd_work_refund(args, cli.output).await
        }
        Command::Work(WorkCommand::Dispute(args)) => {
            commands::cmd_work_dispute(args, cli.output).await
        }
    }
}
