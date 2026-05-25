//! Command implementations. One handler per top-level subcommand.

use crate::config::{default_keys_dir, default_path, load, save, CliConfig, SignerConfig};
use crate::output::{emit, OutputMode};
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tai_core::{
    hire_quote, AgentTreasuryView, Ed25519FileSigner, LaunchpadAccountView, Network, ObjectId,
    RpcClient, Signer, TaiClient, TaiConfig,
};

// ============================================================================
//  tai init
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct InitArgs {
    /// Path to the config file. Defaults to ~/.tai/config.toml.
    #[arg(long)]
    pub config_path: Option<PathBuf>,

    /// Which Sui network to target.
    #[arg(long, default_value = "testnet")]
    pub network: String,

    /// Signer mode. Today only `ed25519` is implemented.
    #[arg(long, default_value = "ed25519")]
    pub signer_mode: String,

    /// Path to the 32-byte seed file (raw or hex). If omitted, defaults to
    /// ~/.tai/keys/default.key.
    #[arg(long)]
    pub key_path: Option<PathBuf>,

    /// Overwrite an existing config file.
    #[arg(long)]
    pub force: bool,
}

pub fn cmd_init(args: InitArgs, output: OutputMode) -> Result<()> {
    let path = match args.config_path {
        Some(p) => p,
        None => default_path()?,
    };

    if path.exists() && !args.force {
        return Err(anyhow!(
            "config already exists at {} — pass --force to overwrite",
            path.display()
        ));
    }

    // Validate the network parses.
    let _network: Network = args
        .network
        .parse()
        .map_err(|e| anyhow!("invalid network: {e}"))?;

    if args.signer_mode != "ed25519" {
        return Err(anyhow!(
            "signer mode `{}` is not yet implemented; only `ed25519` is supported in v1",
            args.signer_mode
        ));
    }

    let key_path = match args.key_path {
        Some(p) => p,
        None => default_keys_dir()?.join("default.key"),
    };

    let cfg = CliConfig {
        network: args.network,
        signer: SignerConfig {
            mode: args.signer_mode,
            key_path: key_path.clone(),
        },
    };

    save(&path, &cfg)?;

    #[derive(Serialize)]
    struct InitOutput {
        ok: bool,
        config_path: String,
        network: String,
        signer_mode: String,
        key_path: String,
        key_present: bool,
        note: Option<String>,
    }

    let key_present = key_path.exists();
    emit(
        output,
        &InitOutput {
            ok: true,
            config_path: path.display().to_string(),
            network: cfg.network,
            signer_mode: cfg.signer.mode,
            key_path: key_path.display().to_string(),
            key_present,
            note: if key_present {
                None
            } else {
                Some(format!(
                    "no key found at {} — put a 32-byte seed (raw or hex) there before running `tai status`",
                    key_path.display()
                ))
            },
        },
    )
}

// ============================================================================
//  tai status
// ============================================================================

pub async fn cmd_status(output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;

    let signer = load_signer(&cfg).await?;
    let address = signer.address();

    let rpc = RpcClient::new(&tai_cfg.rpc_url);
    let sui_balance_mist = fetch_total_sui_balance(&rpc, address.to_string()).await?;

    #[derive(Serialize)]
    struct StatusOutput {
        config_path: String,
        network: String,
        rpc_url: String,
        tai_package_id: String,
        launchpad_config_id: String,
        signer_address: String,
        signer_mode: String,
        sui_balance_mist: u128,
        sui_balance: f64,
    }

    emit(
        output,
        &StatusOutput {
            config_path: default_path()?.display().to_string(),
            network: cfg.network.clone(),
            rpc_url: tai_cfg.rpc_url,
            tai_package_id: tai_cfg.package_id.to_string(),
            launchpad_config_id: tai_cfg.config_id.to_string(),
            signer_address: address.to_string(),
            signer_mode: cfg.signer.mode,
            sui_balance_mist,
            sui_balance: sui_balance_mist as f64 / 1e9,
        },
    )
}

async fn fetch_total_sui_balance(rpc: &RpcClient, addr: String) -> Result<u128> {
    let v: serde_json::Value = rpc
        .call("suix_getBalance", serde_json::json!([addr, "0x2::sui::SUI"]))
        .await
        .context("suix_getBalance")?;
    let raw = v
        .get("totalBalance")
        .and_then(|x| x.as_str())
        .unwrap_or("0");
    raw.parse::<u128>().context("parsing totalBalance")
}

// ============================================================================
//  tai account show
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct AccountShowArgs {
    /// LaunchpadAccount<T> object id to read.
    #[arg(long)]
    pub launchpad: String,
}

pub async fn cmd_account_show(args: AccountShowArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let rpc = RpcClient::new(&tai_cfg.rpc_url);

    let id: ObjectId = args
        .launchpad
        .parse()
        .map_err(|e| anyhow!("invalid LaunchpadAccount id: {e}"))?;
    let account = LaunchpadAccountView::fetch(&rpc, id).await?;
    let treasury = AgentTreasuryView::fetch(&rpc, account.agent_treasury_id).await?;
    let quote = hire_quote(&account);

    #[derive(Serialize)]
    struct AccountOut {
        launchpad_id: String,
        coin_type: String,
        creator: String,
        coin_type_name: String,
        total_supply: u64,
        decimals: u8,
        balances: Balances,
        nav: Nav,
        access: Access,
        sibling: Sibling,
        counters: Counters,
        treasury_balances: TreasuryBalances,
        hire_quote: HireQuoteOut,
        launched_at_ms: u64,
    }
    #[derive(Serialize)]
    struct Balances { real_sui: u64, real_token: u64, virtual_sui_reserves: u64, virtual_token_reserves: u64, lp_reserve: u64 }
    #[derive(Serialize)]
    struct Nav { nav_sui: u64, nav_token: u64, lifetime_service_revenue_sui: u64, cred_revenue_target: u64 }
    #[derive(Serialize)]
    struct Access { access_threshold: u64, accept_coin_payments: bool, linked_identity: Option<String> }
    #[derive(Serialize)]
    struct Sibling { agent_treasury_id: String, treasury_cap_holder_id: String, owner_cap_id: String, dwallets_object_id: Option<String> }
    #[derive(Serialize)]
    struct Counters { total_buys: u64, total_sells: u64, total_service_payments_sui: u64, total_service_payments_token: u64, cumulative_volume_sui: u64, cumulative_fees_sui: u64 }
    #[derive(Serialize)]
    struct TreasuryBalances { sui_balance: u64, token_balance: u64, active_operator_cap_count: usize }
    #[derive(Serialize)]
    struct HireQuoteOut { multiplier_bps: u64, hire_price_sui_mist: u64, hire_price_sui: f64 }

    emit(
        output,
        &AccountOut {
            launchpad_id: account.object_id.to_string(),
            coin_type: account.coin_type.clone(),
            creator: account.creator.to_string(),
            coin_type_name: account.coin_type_name.clone(),
            total_supply: account.total_supply,
            decimals: account.decimals,
            balances: Balances {
                real_sui: account.real_sui,
                real_token: account.real_token,
                virtual_sui_reserves: account.virtual_sui_reserves,
                virtual_token_reserves: account.virtual_token_reserves,
                lp_reserve: account.lp_reserve,
            },
            nav: Nav {
                nav_sui: account.nav_sui,
                nav_token: account.nav_token,
                lifetime_service_revenue_sui: account.lifetime_service_revenue_sui,
                cred_revenue_target: account.cred_revenue_target,
            },
            access: Access {
                access_threshold: account.access_threshold,
                accept_coin_payments: account.accept_coin_payments,
                linked_identity: account.linked_identity.map(|x| x.to_string()),
            },
            sibling: Sibling {
                agent_treasury_id: account.agent_treasury_id.to_string(),
                treasury_cap_holder_id: account.treasury_cap_holder_id.to_string(),
                owner_cap_id: account.owner_cap_id.to_string(),
                dwallets_object_id: account.dwallets_object_id.map(|x| x.to_string()),
            },
            counters: Counters {
                total_buys: account.total_buys,
                total_sells: account.total_sells,
                total_service_payments_sui: account.total_service_payments_sui,
                total_service_payments_token: account.total_service_payments_token,
                cumulative_volume_sui: account.cumulative_volume_sui,
                cumulative_fees_sui: account.cumulative_fees_sui,
            },
            treasury_balances: TreasuryBalances {
                sui_balance: treasury.sui_balance,
                token_balance: treasury.token_balance,
                active_operator_cap_count: treasury.active_operator_cap_ids.len(),
            },
            hire_quote: HireQuoteOut {
                multiplier_bps: quote.multiplier_bps,
                hire_price_sui_mist: quote.hire_price_sui,
                hire_price_sui: quote.hire_price_sui as f64 / 1e9,
            },
            launched_at_ms: account.launched_at,
        },
    )
}

// ============================================================================
//  tai quote
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct QuoteArgs {
    #[arg(long)]
    pub launchpad: String,
}

pub async fn cmd_quote(args: QuoteArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let rpc = RpcClient::new(&tai_cfg.rpc_url);

    let id: ObjectId = args
        .launchpad
        .parse()
        .map_err(|e| anyhow!("invalid LaunchpadAccount id: {e}"))?;
    let account = LaunchpadAccountView::fetch(&rpc, id).await?;
    let q = hire_quote(&account);

    #[derive(Serialize)]
    struct QuoteOut {
        launchpad_id: String,
        nav_sui_mist: u64,
        lifetime_service_revenue_sui_mist: u64,
        cred_revenue_target_mist: u64,
        multiplier_bps: u64,
        multiplier: f64,
        hire_price_mist: u64,
        hire_price_sui: f64,
    }

    emit(
        output,
        &QuoteOut {
            launchpad_id: account.object_id.to_string(),
            nav_sui_mist: q.nav_sui,
            lifetime_service_revenue_sui_mist: q.lifetime_service_revenue_sui,
            cred_revenue_target_mist: q.cred_revenue_target,
            multiplier_bps: q.multiplier_bps,
            multiplier: q.multiplier_bps as f64 / 10_000.0,
            hire_price_mist: q.hire_price_sui,
            hire_price_sui: q.hire_price_sui as f64 / 1e9,
        },
    )
}

// ============================================================================
//  tai pay sui
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct PaySuiArgs {
    /// LaunchpadAccount<T> id to pay.
    #[arg(long)]
    pub launchpad: String,

    /// Concrete coin type (e.g. 0xabc::larry::LARRY).
    #[arg(long)]
    pub coin_type: String,

    /// Object id of a Coin<SUI> you own that will be consumed as the payment.
    #[arg(long)]
    pub payment_coin: String,
}

pub async fn cmd_pay_sui(args: PaySuiArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let launchpad: ObjectId = args
        .launchpad
        .parse()
        .map_err(|e| anyhow!("invalid launchpad id: {e}"))?;
    let payment: ObjectId = args
        .payment_coin
        .parse()
        .map_err(|e| anyhow!("invalid payment-coin id: {e}"))?;

    let result = client
        .record_service_payment_sui(&args.coin_type, launchpad, payment)
        .await?;

    #[derive(Serialize)]
    struct PayOut {
        ok: bool,
        digest: String,
        launchpad_id: String,
        coin_type: String,
        payment_coin: String,
        sender: String,
    }
    emit(
        output,
        &PayOut {
            ok: true,
            digest: result.digest,
            launchpad_id: launchpad.to_string(),
            coin_type: args.coin_type,
            payment_coin: payment.to_string(),
            sender: client.sender().to_string(),
        },
    )
}

// ============================================================================
//  shared helpers
// ============================================================================

fn load_cli_config_or_explain() -> Result<CliConfig> {
    let path = default_path()?;
    if !path.exists() {
        return Err(anyhow!(
            "no config at {}. run `tai init` first",
            path.display()
        ));
    }
    load(&path)
}

fn tai_config_for(cli: &CliConfig) -> Result<TaiConfig> {
    let net = cli.network()?;
    match net {
        Network::Testnet => Ok(TaiConfig::testnet_v1()),
        other => Err(anyhow!(
            "no canonical TaiConfig for network {:?} yet — testnet only in v1",
            other
        )),
    }
}

async fn load_signer(cli: &CliConfig) -> Result<Arc<dyn Signer>> {
    if cli.signer.mode != "ed25519" {
        return Err(anyhow!(
            "signer mode `{}` not implemented; v1 supports `ed25519` only",
            cli.signer.mode
        ));
    }
    if !cli.signer.key_path.exists() {
        return Err(anyhow!(
            "key file not found at {} — place a 32-byte seed (raw or hex) there",
            cli.signer.key_path.display()
        ));
    }
    let signer = Ed25519FileSigner::load_from_file(&cli.signer.key_path)
        .await
        .with_context(|| format!("loading {}", cli.signer.key_path.display()))?;
    Ok(Arc::new(signer))
}
