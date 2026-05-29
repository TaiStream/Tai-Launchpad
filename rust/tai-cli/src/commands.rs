//! Command implementations. One handler per top-level subcommand.

use crate::config::{default_keys_dir, default_path, load, save, CliConfig, SignerConfig};
use crate::launch::{publish_with_sui, render_template, LaunchSummary, PublishOutcome};
use crate::output::{emit, OutputMode};
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tai_core::{
    hire_quote, save_seed_to_file, AgentTreasuryView, Ed25519FileSigner, LaunchpadAccountView,
    Network, ObjectId, RpcClient, Signer, TaiClient, TaiConfig, WorkOrderView,
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

    /// Generate a fresh Ed25519 keypair and write the seed to `--key-path`
    /// with `0600` permissions. Skipped if the key file already exists.
    /// The generated seed is *never* printed — only its derived address.
    ///
    /// Defaults to true when no key exists at the target path; pass
    /// `--no-generate-key` to skip generation and require the user to
    /// place a key file there themselves.
    #[arg(long, default_value_t = true,
          action = clap::ArgAction::Set,
          num_args = 0..=1,
          require_equals = true,
          default_missing_value = "true")]
    pub generate_key: bool,

    /// Overwrite an existing config file.
    #[arg(long)]
    pub force: bool,
}

pub async fn cmd_init(args: InitArgs, output: OutputMode) -> Result<()> {
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

    // Generate a fresh keypair if requested AND none exists at the path.
    // We never print the seed — only the derived address. The key file is
    // written `0600` on Unix; the user can copy it elsewhere themselves.
    let mut generated_address: Option<String> = None;
    if args.generate_key && !key_path.exists() {
        let mut seed = [0u8; 32];
        rand::Rng::fill(&mut rand::thread_rng(), &mut seed);
        save_seed_to_file(&seed, &key_path)
            .await
            .map_err(|e| anyhow!("writing key file: {e}"))?;
        // Compute the address for the printed summary.
        let signer = tai_core::Ed25519FileSigner::from_seed(seed);
        generated_address = Some(signer.address().to_string());
    }

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
        generated_new_key: bool,
        signer_address: Option<String>,
        note: Option<String>,
    }

    let key_present = key_path.exists();
    let generated_new_key = generated_address.is_some();
    emit(
        output,
        &InitOutput {
            ok: true,
            config_path: path.display().to_string(),
            network: cfg.network,
            signer_mode: cfg.signer.mode,
            key_path: key_path.display().to_string(),
            key_present,
            generated_new_key,
            signer_address: generated_address,
            note: if key_present {
                if generated_new_key {
                    Some("Fresh Ed25519 keypair generated and saved with 0600 permissions. Fund the printed address from the Sui testnet faucet, then run `tai status`.".into())
                } else {
                    None
                }
            } else {
                Some(format!(
                    "no key at {}. Run `tai init --generate-key` to create one, OR place a 32-byte seed (raw or hex) there yourself.",
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
        .call(
            "suix_getBalance",
            serde_json::json!([addr, "0x2::sui::SUI"]),
        )
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
    struct Balances {
        real_sui: u64,
        real_token: u64,
        virtual_sui_reserves: u64,
        virtual_token_reserves: u64,
        lp_reserve: u64,
    }
    #[derive(Serialize)]
    struct Nav {
        nav_sui: u64,
        nav_token: u64,
        lifetime_service_revenue_sui: u64,
        cred_revenue_target: u64,
    }
    #[derive(Serialize)]
    struct Access {
        access_threshold: u64,
        accept_coin_payments: bool,
        linked_identity: Option<String>,
    }
    #[derive(Serialize)]
    struct Sibling {
        agent_treasury_id: String,
        treasury_cap_holder_id: String,
        owner_cap_id: String,
        dwallets_object_id: Option<String>,
    }
    #[derive(Serialize)]
    struct Counters {
        total_buys: u64,
        total_sells: u64,
        total_service_payments_sui: u64,
        total_service_payments_token: u64,
        cumulative_volume_sui: u64,
        cumulative_fees_sui: u64,
    }
    #[derive(Serialize)]
    struct TreasuryBalances {
        sui_balance: u64,
        token_balance: u64,
        active_operator_cap_count: usize,
    }
    #[derive(Serialize)]
    struct HireQuoteOut {
        multiplier_bps: u64,
        hire_price_sui_mist: u64,
        hire_price_sui: f64,
    }

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

// ============================================================================
//  tai launch — generate + publish coin + chain launch_agent_coin
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct LaunchArgs {
    /// Coin symbol (ASCII letters; used as both metadata symbol and to seed
    /// the module name).
    #[arg(long)]
    pub symbol: String,
    /// Human-readable coin name. Printable ASCII, no double quotes.
    #[arg(long)]
    pub name: String,
    /// Coin description. Printable ASCII.
    #[arg(long, default_value = "")]
    pub description: String,
    /// Icon image URL.
    #[arg(long, default_value = "")]
    pub icon_url: String,
    /// Decimals — Sui convention is 9.
    #[arg(long, default_value_t = 9)]
    pub decimals: u8,

    /// Path to the `sui` binary used for publish. Defaults to "sui" on PATH.
    #[arg(long, default_value = "sui")]
    pub sui_bin: String,
    /// Gas budget (MIST) for the publish + launch chain.
    #[arg(long, default_value_t = 800_000_000)]
    pub gas_budget_mist: u64,

    /// OwnerCap recipient address. Defaults to the configured signer's
    /// address (sovereign mode).
    #[arg(long)]
    pub owner_cap_recipient: Option<String>,
    /// OperatorCap recipient address. If omitted, no OperatorCap is minted.
    #[arg(long)]
    pub operator_recipient: Option<String>,
    /// Daily SUI spend limit for the OperatorCap.
    #[arg(long, default_value_t = 0)]
    pub operator_daily_limit_sui: u64,
    /// Daily token spend limit for the OperatorCap.
    #[arg(long, default_value_t = 0)]
    pub operator_daily_limit_token: u64,
    /// Allowed-targets for the OperatorCap (repeatable).
    #[arg(long)]
    pub operator_target: Vec<String>,
    /// OperatorCap TTL in milliseconds. 0 = never expires.
    #[arg(long, default_value_t = 30 * 86_400_000)]
    pub operator_ttl_ms: u64,

    /// Skip the launch_agent_coin chain step (publish only). Useful for
    /// debugging the template; the user then runs launch_agent_coin
    /// manually with the printed ids.
    #[arg(long, default_value_t = false)]
    pub publish_only: bool,
}

pub async fn cmd_launch(args: LaunchArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let signer_addr = signer.address().to_string();
    let owner_recipient = args
        .owner_cap_recipient
        .clone()
        .unwrap_or_else(|| signer_addr.clone());

    // 1. Render template. `caps_recipient` is the tai-cli signer's address
    //    so the `init` function transfers TreasuryCap + CoinMetadata directly
    //    to the address that will sign the chained `launch_agent_coin` —
    //    sidestepping the mismatch where sui CLI's active address publishes
    //    but tai-cli's signer needs to own the caps to consume them.
    let (tmp_dir, names) = render_template(
        &args.symbol,
        &args.name,
        &args.description,
        &args.icon_url,
        args.decimals,
        &signer_addr,
    )?;
    eprintln!(
        "[tai launch] generated coin module: {} (witness {})",
        names.module, names.witness
    );
    eprintln!("[tai launch] package dir: {}", tmp_dir.path().display());

    // 2. Publish via subprocess `sui`.
    let publish =
        publish_with_sui(tmp_dir.path(), &args.sui_bin, args.gas_budget_mist, &names).await?;
    eprintln!(
        "[tai launch] published: package={} treasury_cap={} metadata={} tx={}",
        publish.package_id,
        publish.treasury_cap_id,
        publish.coin_metadata_id,
        publish.publish_tx_digest
    );

    if args.publish_only {
        return emit_publish_only(output, &publish, &names, &owner_recipient);
    }

    // 3. Chain launch_agent_coin via tai-core.
    let client = TaiClient::new(tai_cfg, signer);
    let treasury_cap: ObjectId = publish
        .treasury_cap_id
        .parse()
        .map_err(|e| anyhow!("invalid treasury_cap id: {e}"))?;
    let metadata_id: ObjectId = publish
        .coin_metadata_id
        .parse()
        .map_err(|e| anyhow!("invalid coin_metadata id: {e}"))?;
    let owner_recipient_parsed: tai_core::SuiAddress = owner_recipient
        .parse()
        .map_err(|e| anyhow!("invalid --owner-cap-recipient: {e}"))?;
    let operator_recipient_opt: Option<tai_core::SuiAddress> = match &args.operator_recipient {
        Some(s) => Some(
            s.parse()
                .map_err(|e| anyhow!("invalid --operator-recipient: {e}"))?,
        ),
        None => None,
    };
    let operator_targets: Vec<tai_core::SuiAddress> = args
        .operator_target
        .iter()
        .map(|s| s.parse::<tai_core::SuiAddress>())
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| anyhow!("invalid --operator-target: {e}"))?;

    let launch_result = client
        .launch_agent_coin(
            &publish.coin_type,
            treasury_cap,
            metadata_id,
            args.name.clone(),
            None, // linked_identity
            owner_recipient_parsed,
            operator_recipient_opt,
            args.operator_daily_limit_sui,
            args.operator_daily_limit_token,
            &operator_targets,
            args.operator_ttl_ms,
        )
        .await?;

    let summary = LaunchSummary {
        agent_name: args.name.clone(),
        coin_type: publish.coin_type.clone(),
        coin_module: names.module.clone(),
        coin_witness: names.witness.clone(),
        coin_package_id: publish.package_id.clone(),
        coin_metadata_id: publish.coin_metadata_id.clone(),
        treasury_cap_id_at_publish: publish.treasury_cap_id.clone(),
        publish_tx_digest: publish.publish_tx_digest.clone(),
        launch_tx_digest: launch_result.digest,
    };
    emit(output, &summary)
}

fn emit_publish_only(
    output: OutputMode,
    publish: &PublishOutcome,
    names: &crate::launch::CoinNames,
    owner_recipient: &str,
) -> Result<()> {
    #[derive(Serialize)]
    struct PublishOnly<'a> {
        action: &'a str,
        coin_type: &'a str,
        coin_module: &'a str,
        coin_witness: &'a str,
        coin_package_id: &'a str,
        coin_metadata_id: &'a str,
        treasury_cap_id: &'a str,
        publish_tx_digest: &'a str,
        owner_cap_recipient: &'a str,
        next_step: &'a str,
    }
    emit(
        output,
        &PublishOnly {
            action: "publish_only",
            coin_type: &publish.coin_type,
            coin_module: &names.module,
            coin_witness: &names.witness,
            coin_package_id: &publish.package_id,
            coin_metadata_id: &publish.coin_metadata_id,
            treasury_cap_id: &publish.treasury_cap_id,
            publish_tx_digest: &publish.publish_tx_digest,
            owner_cap_recipient: owner_recipient,
            next_step:
                "Call tai::launchpad::launch_agent_coin<T> with the printed treasury_cap_id + coin_metadata_id + your launch flags.",
        },
    )
}

// ============================================================================
//  tai buy / tai sell — bonding curve trades
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct BuyArgs {
    /// LaunchpadAccount<T> object id.
    #[arg(long)]
    pub launchpad: String,
    /// Coin type (e.g. "0x...::larry::LARRY").
    #[arg(long)]
    pub coin_type: String,
    /// SUI coin object holding the amount to spend (full balance is consumed
    /// into the trade; split first if you want partial).
    #[arg(long)]
    pub payment_coin: String,
    /// Minimum tokens out, in base units. 0 disables slippage protection.
    #[arg(long, default_value_t = 0)]
    pub min_tokens_out: u64,
}

pub async fn cmd_buy(args: BuyArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let lp: ObjectId = args
        .launchpad
        .parse()
        .map_err(|e| anyhow!("invalid --launchpad: {e}"))?;
    let coin: ObjectId = args
        .payment_coin
        .parse()
        .map_err(|e| anyhow!("invalid --payment-coin: {e}"))?;

    let result = client
        .buy(&args.coin_type, lp, coin, args.min_tokens_out)
        .await?;

    #[derive(Serialize)]
    struct Out {
        ok: bool,
        action: &'static str,
        digest: String,
        launchpad: String,
        coin_type: String,
        payment_coin: String,
        min_tokens_out: u64,
    }
    emit(
        output,
        &Out {
            ok: true,
            action: "buy",
            digest: result.digest,
            launchpad: lp.to_string(),
            coin_type: args.coin_type,
            payment_coin: coin.to_string(),
            min_tokens_out: args.min_tokens_out,
        },
    )
}

#[derive(clap::Args, Debug)]
pub struct SellArgs {
    /// LaunchpadAccount<T> object id.
    #[arg(long)]
    pub launchpad: String,
    /// Coin type.
    #[arg(long)]
    pub coin_type: String,
    /// Coin<T> object holding the tokens to sell (full balance is consumed).
    #[arg(long)]
    pub tokens_coin: String,
    /// Minimum SUI out, in MIST. 0 disables slippage protection.
    #[arg(long, default_value_t = 0)]
    pub min_sui_out: u64,
}

pub async fn cmd_sell(args: SellArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let lp: ObjectId = args
        .launchpad
        .parse()
        .map_err(|e| anyhow!("invalid --launchpad: {e}"))?;
    let tokens: ObjectId = args
        .tokens_coin
        .parse()
        .map_err(|e| anyhow!("invalid --tokens-coin: {e}"))?;

    let result = client
        .sell(&args.coin_type, lp, tokens, args.min_sui_out)
        .await?;

    #[derive(Serialize)]
    struct Out {
        ok: bool,
        action: &'static str,
        digest: String,
        launchpad: String,
        coin_type: String,
        tokens_coin: String,
        min_sui_out: u64,
    }
    emit(
        output,
        &Out {
            ok: true,
            action: "sell",
            digest: result.digest,
            launchpad: lp.to_string(),
            coin_type: args.coin_type,
            tokens_coin: tokens.to_string(),
            min_sui_out: args.min_sui_out,
        },
    )
}

// ============================================================================
//  tai hire — create a work-order escrow
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct HireArgs {
    /// The payee agent's `LaunchpadAccount<T>` object id.
    #[arg(long)]
    pub agent: String,
    /// The payee agent's coin type (e.g. `0xabc::larry::LARRY`).
    #[arg(long)]
    pub coin_type: String,
    /// SUI Coin object holding the amount to lock in escrow.
    #[arg(long)]
    pub payment_coin: String,
    /// Hex-encoded spec hash (no `0x` prefix). Empty = no hash.
    #[arg(long, default_value = "")]
    pub spec_hash: String,
    /// Off-chain URL where the work spec lives.
    #[arg(long, default_value = "")]
    pub spec_url: String,
    /// Deadline (UNIX milliseconds). Must be > now.
    #[arg(long)]
    pub deadline_ms: u64,
    /// Post-receipt dispute window in ms (max 2,592,000,000 = 30 days).
    #[arg(long, default_value_t = 86_400_000)]
    pub dispute_window_ms: u64,
}

pub async fn cmd_hire(args: HireArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let agent: ObjectId = args
        .agent
        .parse()
        .map_err(|e| anyhow!("invalid agent id: {e}"))?;
    let payment: ObjectId = args
        .payment_coin
        .parse()
        .map_err(|e| anyhow!("invalid payment-coin id: {e}"))?;

    let spec_hash =
        parse_hex(&args.spec_hash).map_err(|e| anyhow!("--spec-hash must be hex: {e}"))?;

    let result = client
        .work_order_create(
            &args.coin_type,
            agent,
            payment,
            &spec_hash,
            &args.spec_url,
            args.deadline_ms,
            args.dispute_window_ms,
        )
        .await?;

    #[derive(Serialize)]
    struct HireOut {
        ok: bool,
        digest: String,
        agent: String,
        coin_type: String,
        payment_coin: String,
        deadline_ms: u64,
        dispute_window_ms: u64,
        buyer: String,
    }
    emit(
        output,
        &HireOut {
            ok: true,
            digest: result.digest,
            agent: agent.to_string(),
            coin_type: args.coin_type,
            payment_coin: payment.to_string(),
            deadline_ms: args.deadline_ms,
            dispute_window_ms: args.dispute_window_ms,
            buyer: client.sender().to_string(),
        },
    )
}

// ============================================================================
//  tai work show — read a WorkOrder<T>
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct WorkShowArgs {
    /// WorkOrder<T> object id.
    #[arg(long)]
    pub id: String,
}

pub async fn cmd_work_show(args: WorkShowArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let rpc = RpcClient::new(tai_cfg.rpc_url.clone());

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let view = WorkOrderView::fetch(&rpc, id).await?;

    #[derive(Serialize)]
    struct Out {
        object_id: String,
        coin_type: String,
        buyer: String,
        payee_launchpad_account_id: String,
        payee_agent_treasury_id: String,
        status: &'static str,
        locked_sui_mist: u64,
        amount_mist: u64,
        spec_hash_hex: String,
        spec_url: String,
        receipt_hash_hex: String,
        receipt_url: String,
        created_at_ms: u64,
        deadline_ms: u64,
        receipt_submitted_at_ms: u64,
        dispute_window_ms: u64,
    }
    emit(
        output,
        &Out {
            object_id: view.object_id.to_string(),
            coin_type: view.coin_type,
            buyer: view.buyer,
            payee_launchpad_account_id: view.payee_launchpad_account_id.to_string(),
            payee_agent_treasury_id: view.payee_agent_treasury_id.to_string(),
            status: view.status.label(),
            locked_sui_mist: view.locked_sui,
            amount_mist: view.amount,
            spec_hash_hex: to_hex(&view.spec_hash),
            spec_url: view.spec_url,
            receipt_hash_hex: to_hex(&view.receipt_hash),
            receipt_url: view.receipt_url,
            created_at_ms: view.created_at_ms,
            deadline_ms: view.deadline_ms,
            receipt_submitted_at_ms: view.receipt_submitted_at_ms,
            dispute_window_ms: view.dispute_window_ms,
        },
    )
}

// ============================================================================
//  tai work accept
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct WorkAcceptArgs {
    /// WorkOrder<T> object id.
    #[arg(long)]
    pub id: String,
    /// The payee agent's coin type.
    #[arg(long)]
    pub coin_type: String,
    /// Cap to use: OwnerCap<T> object id.
    #[arg(long, conflicts_with = "operator_cap")]
    pub owner_cap: Option<String>,
    /// Cap to use: OperatorCap<T> object id.
    #[arg(long, conflicts_with = "owner_cap")]
    pub operator_cap: Option<String>,
}

pub async fn cmd_work_accept(args: WorkAcceptArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let rpc_url = tai_cfg.rpc_url.clone();
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let result = match (args.owner_cap, args.operator_cap) {
        (Some(c), None) => {
            let cap: ObjectId = c.parse().map_err(|e| anyhow!("invalid --owner-cap: {e}"))?;
            client
                .work_order_accept_with_owner(&args.coin_type, id, cap)
                .await?
        }
        (None, Some(c)) => {
            let cap: ObjectId = c
                .parse()
                .map_err(|e| anyhow!("invalid --operator-cap: {e}"))?;
            // The operator path verifies the cap against the agent treasury's
            // active set, so we need the order's payee treasury id.
            let rpc = RpcClient::new(rpc_url.clone());
            let view = WorkOrderView::fetch(&rpc, id).await?;
            client
                .work_order_accept_with_operator(
                    &args.coin_type,
                    id,
                    cap,
                    view.payee_agent_treasury_id,
                )
                .await?
        }
        _ => {
            return Err(anyhow!(
                "provide exactly one of --owner-cap or --operator-cap"
            ))
        }
    };

    emit_tx_ok(output, "work_order.accept", &result.digest, &id.to_string())
}

// ============================================================================
//  tai work submit-receipt
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct WorkSubmitReceiptArgs {
    /// WorkOrder<T> object id.
    #[arg(long)]
    pub id: String,
    /// The payee agent's coin type.
    #[arg(long)]
    pub coin_type: String,
    /// OwnerCap<T> id (mutually exclusive with --operator-cap).
    #[arg(long, conflicts_with = "operator_cap")]
    pub owner_cap: Option<String>,
    /// OperatorCap<T> id.
    #[arg(long, conflicts_with = "owner_cap")]
    pub operator_cap: Option<String>,
    /// Hex-encoded receipt content hash.
    #[arg(long, default_value = "")]
    pub receipt_hash: String,
    /// Off-chain URL pointing to the delivered work artifact.
    #[arg(long, default_value = "")]
    pub receipt_url: String,
}

pub async fn cmd_work_submit_receipt(
    args: WorkSubmitReceiptArgs,
    output: OutputMode,
) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let rpc_url = tai_cfg.rpc_url.clone();
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let receipt_hash =
        parse_hex(&args.receipt_hash).map_err(|e| anyhow!("--receipt-hash must be hex: {e}"))?;

    let result = match (args.owner_cap, args.operator_cap) {
        (Some(c), None) => {
            let cap: ObjectId = c.parse().map_err(|e| anyhow!("invalid --owner-cap: {e}"))?;
            client
                .work_order_submit_receipt_with_owner(
                    &args.coin_type,
                    id,
                    cap,
                    &receipt_hash,
                    &args.receipt_url,
                )
                .await?
        }
        (None, Some(c)) => {
            let cap: ObjectId = c
                .parse()
                .map_err(|e| anyhow!("invalid --operator-cap: {e}"))?;
            // Operator path needs the order's payee treasury id for the
            // active-cap check.
            let rpc = RpcClient::new(rpc_url.clone());
            let view = WorkOrderView::fetch(&rpc, id).await?;
            client
                .work_order_submit_receipt_with_operator(
                    &args.coin_type,
                    id,
                    cap,
                    view.payee_agent_treasury_id,
                    &receipt_hash,
                    &args.receipt_url,
                )
                .await?
        }
        _ => {
            return Err(anyhow!(
                "provide exactly one of --owner-cap or --operator-cap"
            ))
        }
    };

    emit_tx_ok(
        output,
        "work_order.submit_receipt",
        &result.digest,
        &id.to_string(),
    )
}

// ============================================================================
//  tai work release / refund / dispute
// ============================================================================

#[derive(clap::Args, Debug)]
pub struct WorkReleaseArgs {
    #[arg(long)]
    pub id: String,
    #[arg(long)]
    pub coin_type: String,
    /// Payee's LaunchpadAccount<T> id (cross-checked against the order).
    #[arg(long)]
    pub payee_account: String,
}

pub async fn cmd_work_release(args: WorkReleaseArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let account: ObjectId = args
        .payee_account
        .parse()
        .map_err(|e| anyhow!("invalid --payee-account: {e}"))?;
    let result = client
        .work_order_release(&args.coin_type, id, account)
        .await?;
    emit_tx_ok(
        output,
        "work_order.release",
        &result.digest,
        &id.to_string(),
    )
}

#[derive(clap::Args, Debug)]
pub struct WorkRefundArgs {
    #[arg(long)]
    pub id: String,
    #[arg(long)]
    pub coin_type: String,
}

pub async fn cmd_work_refund(args: WorkRefundArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let result = client.work_order_refund(&args.coin_type, id).await?;
    emit_tx_ok(output, "work_order.refund", &result.digest, &id.to_string())
}

#[derive(clap::Args, Debug)]
pub struct WorkDisputeArgs {
    #[arg(long)]
    pub id: String,
    #[arg(long)]
    pub coin_type: String,
}

pub async fn cmd_work_dispute(args: WorkDisputeArgs, output: OutputMode) -> Result<()> {
    let cfg = load_cli_config_or_explain()?;
    let tai_cfg = tai_config_for(&cfg)?;
    let signer = load_signer(&cfg).await?;
    let client = TaiClient::new(tai_cfg, signer);

    let id: ObjectId = args.id.parse().map_err(|e| anyhow!("invalid id: {e}"))?;
    let result = client.work_order_open_dispute(&args.coin_type, id).await?;
    emit_tx_ok(
        output,
        "work_order.dispute",
        &result.digest,
        &id.to_string(),
    )
}

// ============================================================================
//  helpers
// ============================================================================

fn parse_hex(s: &str) -> std::result::Result<Vec<u8>, String> {
    let s = s.trim().trim_start_matches("0x");
    if s.is_empty() {
        return Ok(Vec::new());
    }
    if s.len() % 2 != 0 {
        return Err("odd-length hex".to_string());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let byte = u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string())?;
        out.push(byte);
    }
    Ok(out)
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2 + 2);
    s.push_str("0x");
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn emit_tx_ok(output: OutputMode, action: &str, digest: &str, target_id: &str) -> Result<()> {
    #[derive(Serialize)]
    struct Out<'a> {
        ok: bool,
        action: &'a str,
        digest: &'a str,
        target_id: &'a str,
    }
    emit(
        output,
        &Out {
            ok: true,
            action,
            digest,
            target_id,
        },
    )
}
