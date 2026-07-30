//! Self-hosted sync server for a Tailscale / LAN host.
//!
//! ```bash
//! tethra-sync-server          # wizard (first run) + live status TUI
//! tethra-sync-server setup    # reconfigure
//! tethra-sync-server serve    # headless (systemd)
//! ```

mod config;
mod server;
mod service;
mod setup;
mod tui;

use std::path::PathBuf;
use std::sync::Arc;

use clap::{Parser, Subcommand};

use config::Config;
use server::Metrics;

#[derive(Parser, Debug)]
#[command(
    name = "tethra-sync-server",
    about = "Host Tethra vault sync over HTTP (Tailscale-friendly)",
    long_about = "First run opens a setup wizard, saves ~/.config/tethra-sync/config.toml, \
optionally installs a systemd user unit, then shows a live status screen.\n\n\
Use `serve` under systemd (no TUI). Flags override the config file when set."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Directory that stores opaque sync rows.
    #[arg(long, env = "TETHRA_SYNC_DATA", global = true)]
    data_dir: Option<PathBuf>,

    /// Bind address (e.g. 0.0.0.0:8787).
    #[arg(long, env = "TETHRA_SYNC_LISTEN", global = true)]
    listen: Option<String>,

    /// Shared bearer token (clients send Authorization: Bearer base64(token)).
    #[arg(long, env = "TETHRA_SYNC_TOKEN", global = true)]
    token: Option<String>,

    /// Client URL hint for the TUI / paste block.
    #[arg(long, env = "TETHRA_SYNC_CLIENT_URL", global = true)]
    client_url: Option<String>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Interactive setup wizard (writes config, optional systemd install).
    Setup,
    /// Run the HTTP server headlessly (for systemd / scripts).
    Serve,
    /// Write and enable the systemd user unit.
    InstallService,
    /// Disable and remove the systemd user unit.
    UninstallService,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Setup) => {
            init_tracing_interactive();
            let config = setup::run_wizard()?;
            tui::run(apply_cli(config, &cli)).await?;
        }
        Some(Commands::Serve) => {
            init_tracing_headless();
            let config = resolve_config(&cli, true)?;
            let metrics = Arc::new(Metrics::default());
            server::serve_until_ctrl_c(config, metrics).await?;
        }
        Some(Commands::InstallService) => {
            init_tracing_interactive();
            let config = resolve_config(&cli, true)?;
            service::install_with_options(true)?;
            println!("Installed and started user service `tethra-sync`.");
            println!("Tip: `loginctl enable-linger $USER` so it survives logout.");
            setup::print_client_block(&config);
        }
        Some(Commands::UninstallService) => {
            init_tracing_interactive();
            service::uninstall()?;
            println!("Removed user service `tethra-sync`.");
        }
        None => {
            init_tracing_interactive();
            let config = match config::load_if_present()? {
                Some(cfg) => apply_cli(cfg, &cli),
                None => {
                    if !atty_stdout() {
                        return Err(
                            "no config found; run interactively once or pass --data-dir/--token \
                             or create ~/.config/tethra-sync/config.toml"
                                .into(),
                        );
                    }
                    apply_cli(setup::run_wizard()?, &cli)
                }
            };
            if config.token.is_empty() {
                return Err("token is empty; run `tethra-sync-server setup`".into());
            }
            tui::run(config).await?;
        }
    }

    Ok(())
}

fn resolve_config(cli: &Cli, require_token: bool) -> Result<Config, String> {
    let base = config::load_if_present()?.unwrap_or_default();
    let config = apply_cli(base, cli);
    if require_token && config.token.is_empty() && cli.token.is_none() {
        // Allow empty only if explicitly overridden? Prefer fail for serve.
        if config.token.is_empty() {
            return Err(
                "no token configured; run `tethra-sync-server setup` or set TETHRA_SYNC_TOKEN"
                    .into(),
            );
        }
    }
    Ok(config)
}

fn apply_cli(base: Config, cli: &Cli) -> Config {
    config::apply_overrides(
        base,
        cli.data_dir.clone(),
        cli.listen.clone(),
        cli.token.clone(),
        cli.client_url.clone(),
    )
}

fn init_tracing_headless() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tethra_sync_server=info,tower_http=info".into()),
        )
        .init();
}

fn init_tracing_interactive() {
    // Keep logs quiet so the TUI / wizard stays readable; still honour RUST_LOG.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "tethra_sync_server=warn,tower_http=warn".into());
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

fn atty_stdout() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
}
