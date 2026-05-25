//! # tai-core
//!
//! Core library for [Tai](https://github.com/TaiStream/Tai-Launchpad) — the
//! tokenized agentic infrastructure layer on Sui.
//!
//! `tai-core` is the single source of truth that both the `tai-cli` binary
//! and the WASM-backed `@tai/sdk` wrap. It exposes:
//!
//! - **PTB builders** for every entry function in the on-chain `tai` Move package.
//! - **A `Signer` abstraction** with pluggable backends: local Ed25519 file,
//!   Sui keystore inheritance, Turnkey MPC, and TEE-attested signing
//!   (Phala Cloud + Mysten Nautilus).
//! - **An indexer client** that subscribes to launchpad events.
//! - **A one-time-witness coin module templater** so an agent can publish
//!   its own creator coin at launch time.
//!
//! See [`TaiClient`](crate::client::TaiClient) for the high-level facade.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod client;
pub mod config;
pub mod error;
pub mod ids;
pub mod reads;
pub mod rpc;
pub mod signer;

pub use client::{ExecutionResult, MoveCall, RequestType, TaiClient, SUI_CLOCK_OBJECT_ID};
pub use config::{Network, TaiConfig};
pub use error::TaiError;
pub use ids::{ObjectId, SuiAddress};
pub use reads::{hire_quote, AgentTreasuryView, HireQuote, LaunchpadAccountView, LaunchpadConfigView};
pub use rpc::RpcClient;
pub use signer::{Ed25519FileSigner, Signer};

/// Crate-wide [`Result`] alias.
pub type Result<T> = std::result::Result<T, TaiError>;
