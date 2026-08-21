//! Interactive first-run / reconfigure wizard.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Command;

use inquire::{Confirm, Select, Text};
use rand::RngCore;

use crate::config::{self, Config};
use crate::service;

pub fn run_wizard() -> Result<Config, String> {
    println!("Tethra sync server setup\n");
    println!("This walks through hosting encrypted vault sync on this machine.");
    println!("Clients (Mac / Windows) will connect over Tailscale.\n");

    let existing = config::load_if_present().ok().flatten();

    let default_data = existing
        .as_ref()
        .map(|c| c.data_dir.display().to_string())
        .unwrap_or_else(|| config::default_data_dir().display().to_string());

    let data_dir = Text::new("Data directory")
        .with_default(&default_data)
        .prompt()
        .map_err(inquire_err)?;
    let data_dir = expand_tilde(data_dir.trim());

    let default_listen = existing
        .as_ref()
        .map(|c| c.listen.clone())
        .unwrap_or_else(|| "0.0.0.0:8787".into());
    let listen = Text::new("Listen address")
        .with_default(&default_listen)
        .with_help_message("Use 0.0.0.0:8787 behind Tailscale ACLs")
        .prompt()
        .map_err(inquire_err)?;
    let listen = listen.trim().to_string();
    let addr: SocketAddr = listen
        .parse()
        .map_err(|e| format!("invalid listen address: {e}"))?;

    let token_choice = Select::new(
        "Shared bearer token",
        vec![
            "Generate a random token (recommended)",
            "Enter a token manually",
        ],
    )
    .prompt()
    .map_err(inquire_err)?;

    let token = if token_choice.starts_with("Generate") {
        let generated = generate_token();
        println!("\nGenerated token (save this — paste into Tethra clients):\n  {generated}\n");
        generated
    } else {
        let default_tok = existing
            .as_ref()
            .map(|c| c.token.clone())
            .unwrap_or_default();
        let mut prompt = Text::new("Token");
        if !default_tok.is_empty() {
            prompt = prompt.with_default(&default_tok);
        }
        prompt
            .with_help_message("Same value on every Tethra client")
            .prompt()
            .map_err(inquire_err)?
            .trim()
            .to_string()
    };
    if token.is_empty() {
        return Err("token must not be empty".into());
    }

    let suggested_url = suggest_client_url(addr.port());
    let client_url = Text::new("Client URL (what Mac/Windows should use)")
        .with_default(&suggested_url)
        .with_help_message("http://<tailscale-hostname>:port")
        .prompt()
        .map_err(inquire_err)?;
    let client_url = client_url.trim().to_string();

    let config = Config {
        data_dir: PathBuf::from(&data_dir),
        listen,
        token: token.clone(),
        client_url: Some(client_url.clone()),
        allow_enroll: false,
    };

    println!("\nSummary");
    println!("  Data     {}", config.data_dir.display());
    println!("  Listen   {}", config.listen);
    println!("  Client   {client_url}");
    println!("  Token    {}", mask_token(&token));

    let ok = Confirm::new("Save this configuration?")
        .with_default(true)
        .prompt()
        .map_err(inquire_err)?;
    if !ok {
        return Err("setup cancelled".into());
    }

    std::fs::create_dir_all(&config.data_dir).map_err(|e| format!("create data dir: {e}"))?;
    config::save_default(&config)?;
    println!("Wrote {}", config::config_path().display());

    print_client_block(&config);

    let install = Confirm::new("Install systemd user service so it survives reboot?")
        .with_default(true)
        .prompt()
        .map_err(inquire_err)?;
    if install {
        match service::install_with_options(false) {
            Ok(()) => {
                println!("Installed user service `tethra-sync` (enabled; will start on login).");
                println!("This session will run the interactive status screen instead.");
                println!("Later: `systemctl --user start tethra-sync` (or reboot with linger).");
                println!(
                    "Tip: run `loginctl enable-linger $USER` so it keeps running after logout."
                );
            }
            Err(e) => {
                eprintln!("Could not install systemd unit: {e}");
                eprintln!("You can retry later with: tethra-sync-server install-service");
            }
        }
    }

    let install_updates =
        Confirm::new("Also install an hourly timer to mirror desktop updates automatically?")
            .with_default(true)
            .prompt()
            .map_err(inquire_err)?;
    if install_updates {
        match service::install_updates_timer() {
            Ok(()) => {
                println!("Installed user timer `tethra-updates.timer` (hourly fetch-updates).");
                println!("Manage with: systemctl --user status tethra-updates.timer");
            }
            Err(e) => {
                eprintln!("Could not install updates timer: {e}");
                eprintln!("You can retry later with: tethra-sync-server install-updates-timer");
            }
        }
    }

    Ok(config)
}

pub fn print_client_block(config: &Config) {
    let url = config
        .client_url
        .clone()
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", config.port().unwrap_or(8787)));
    println!("\n── Paste into Tethra (Vault sync → HTTP server) ──");
    println!("  URL    {url}");
    println!("  Token  {}", config.token);
    println!("────────────────────────────────────────────────\n");
}

pub fn mask_token(token: &str) -> String {
    if token.chars().count() <= 4 {
        return "••••".into();
    }
    format!("{}…", token.chars().take(4).collect::<String>())
}

fn generate_token() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/")
        && let Some(home) = config::home_dir()
    {
        return home.join(rest).display().to_string();
    }
    if path == "~"
        && let Some(home) = config::home_dir()
    {
        return home.display().to_string();
    }
    path.to_string()
}

fn suggest_client_url(port: u16) -> String {
    if let Some(name) = tailscale_dns_name() {
        return format!("http://{name}:{port}");
    }
    if let Ok(host) = hostname()
        && !host.is_empty()
        && host != "localhost"
    {
        return format!("http://{host}:{port}");
    }
    format!("http://127.0.0.1:{port}")
}

pub fn tailscale_dns_name() -> Option<String> {
    let output = Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    // Self.DNSName is like "sync-host.tailnet.ts.net."
    let dns = json
        .pointer("/Self/DNSName")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('.').to_string())
        .filter(|s| !s.is_empty());
    if dns.is_some() {
        return dns;
    }
    json.pointer("/Self/HostName")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

fn hostname() -> Result<String, std::io::Error> {
    let output = Command::new("hostname").output()?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn inquire_err(e: inquire::InquireError) -> String {
    format!("prompt: {e}")
}
