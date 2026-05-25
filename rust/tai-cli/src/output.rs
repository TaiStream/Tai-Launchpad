//! Output mode handling.
//!
//! Default: JSON when stdout is piped, pretty (key/value table) when stdout
//! is a TTY. Override via `--output {json,pretty,auto}` global flag.

use serde::Serialize;
use std::io::IsTerminal;

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub enum OutputMode {
    /// JSON when piped; pretty when stdout is a TTY.
    Auto,
    /// Always emit machine-readable JSON.
    Json,
    /// Always emit human-readable pretty output.
    Pretty,
}

impl OutputMode {
    pub fn resolve(self) -> ResolvedMode {
        match self {
            OutputMode::Json => ResolvedMode::Json,
            OutputMode::Pretty => ResolvedMode::Pretty,
            OutputMode::Auto => {
                if std::io::stdout().is_terminal() {
                    ResolvedMode::Pretty
                } else {
                    ResolvedMode::Json
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ResolvedMode {
    Json,
    Pretty,
}

/// Emit a structured value. JSON uses serde_json; pretty falls back to the
/// JSON representation indented + colored only for now (the `pretty` mode
/// is the default for humans but doesn't need to be fancier than indented
/// JSON in v1).
pub fn emit<T: Serialize>(mode: OutputMode, value: &T) -> anyhow::Result<()> {
    match mode.resolve() {
        ResolvedMode::Json => {
            // Single-line JSON for machine consumers.
            let s = serde_json::to_string(value)?;
            println!("{}", s);
        }
        ResolvedMode::Pretty => {
            // Indented for humans. Same shape as JSON output — the user can
            // always grep / jq it; no separate "human format" surface to
            // accidentally diverge from JSON.
            let s = serde_json::to_string_pretty(value)?;
            println!("{}", s);
        }
    }
    Ok(())
}
