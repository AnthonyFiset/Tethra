//! Headless SSH/SFTP CLI harness for M1.
//!
//! ```text
//! cargo run -p core --example ssh-client --features cli -- \
//!   exec --host 127.0.0.1 --port 2222 --user test --password-env SSH_PASS -- uname -a
//! ```

use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Arc;

use clap::{Parser, Subcommand};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use ssh_client_core::model::{Host, PtySize};
use ssh_client_core::ssh::{
    AuthProvider, HostKeyDecision, HostKeyPolicy, HostStore, InMemoryHostStore, PresentedHostKey,
    SessionManager, StaticAuthProvider,
};
use ssh_client_core::{Error, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::signal;
use uuid::Uuid;

#[derive(Parser, Debug)]
#[command(name = "ssh-client", about = "M1 headless SSH/SFTP harness")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    #[arg(long, short, default_value_t = 22)]
    port: u16,

    #[arg(long, short, default_value = "root")]
    user: String,

    /// Read password from this environment variable (preferred over --password).
    #[arg(long)]
    password_env: Option<String>,

    /// Password (avoid in shared shells; prefer --password-env).
    #[arg(long)]
    password: Option<String>,

    /// Path to an OpenSSH private key.
    #[arg(long, short = 'i')]
    identity: Option<PathBuf>,

    /// Passphrase for an encrypted private key (or set SSH_KEY_PASSPHRASE).
    #[arg(long)]
    passphrase: Option<String>,

    /// Auto-accept unknown host keys (still refuses mismatches).
    #[arg(long, default_value_t = false)]
    accept_new_host_key: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Interactive shell over a PTY.
    Shell,
    /// Run a remote command (no PTY).
    Exec {
        #[arg(trailing_var_arg = true, required = true)]
        command: Vec<String>,
    },
    /// List a remote directory.
    SftpList {
        #[arg(default_value = ".")]
        path: String,
    },
    /// Download a remote file.
    SftpGet { remote: String, local: PathBuf },
    /// Upload a local file.
    SftpPut { local: PathBuf, remote: String },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(io::stderr)
        .init();

    if let Err(err) = run().await {
        eprintln!("error: {err}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();
    let auth = build_auth(&cli)?;
    let hosts = Arc::new(InMemoryHostStore::new());
    let host = Host::new("cli", cli.host.clone(), cli.user.clone()).with_port(cli.port);
    let host_id = hosts.insert(host).await;

    let policy: Arc<dyn HostKeyPolicy> = if cli.accept_new_host_key {
        Arc::new(ssh_client_core::ssh::TofuHostKeyPolicy)
    } else {
        Arc::new(PromptHostKeyPolicy)
    };

    let mgr = SessionManager::new(
        hosts as Arc<dyn HostStore>,
        auth,
        policy,
        Arc::new(ssh_client_core::ssh::AlwaysApprove),
    );

    match cli.command {
        Commands::Shell => run_shell(&mgr, host_id).await?,
        Commands::Exec { command } => {
            let cmd = command.join(" ");
            let result = mgr.exec(host_id, &cmd).await?;
            io::stdout().write_all(&result.stdout)?;
            io::stderr().write_all(&result.stderr)?;
            if result.exit_code != 0 {
                std::process::exit(result.exit_code as i32);
            }
        }
        Commands::SftpList { path } => {
            let sftp = mgr.sftp(host_id).await?;
            let entries = sftp.list(&path).await?;
            for entry in entries {
                let kind = match entry.file_type {
                    ssh_client_core::ssh::RemoteFileType::Dir => "dir",
                    ssh_client_core::ssh::RemoteFileType::File => "file",
                    ssh_client_core::ssh::RemoteFileType::Symlink => "link",
                    ssh_client_core::ssh::RemoteFileType::Other => "other",
                };
                let size = entry
                    .size
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "-".into());
                println!("{kind:>5} {size:>12} {}", entry.name);
            }
            sftp.close().await?;
        }
        Commands::SftpGet { remote, local } => {
            let sftp = mgr.sftp(host_id).await?;
            sftp.get(&remote, &local).await?;
            sftp.close().await?;
            eprintln!("downloaded {remote} -> {}", local.display());
        }
        Commands::SftpPut { local, remote } => {
            let sftp = mgr.sftp(host_id).await?;
            sftp.put(&local, &remote).await?;
            sftp.close().await?;
            eprintln!("uploaded {} -> {remote}", local.display());
        }
    }

    Ok(())
}

fn build_auth(cli: &Cli) -> Result<Arc<dyn AuthProvider>> {
    if let Some(path) = &cli.identity {
        let key = std::fs::read(path)?;
        let passphrase = cli
            .passphrase
            .clone()
            .or_else(|| std::env::var("SSH_KEY_PASSPHRASE").ok());
        return Ok(Arc::new(StaticAuthProvider::private_key(key, passphrase)));
    }

    let password = if let Some(env_name) = &cli.password_env {
        std::env::var(env_name).map_err(|_| {
            Error::InvalidArgument(format!("environment variable {env_name} is not set"))
        })?
    } else if let Some(p) = &cli.password {
        p.clone()
    } else {
        eprint!("password: ");
        let _ = io::stderr().flush();
        rpassword::read_password().map_err(|e| Error::Other(e.to_string()))?
    };

    Ok(Arc::new(StaticAuthProvider::password(password)))
}

struct PromptHostKeyPolicy;

#[async_trait::async_trait]
impl HostKeyPolicy for PromptHostKeyPolicy {
    async fn decide(
        &self,
        _host_id: Uuid,
        presented: &PresentedHostKey,
        _known: Option<&ssh_client_core::model::KnownHostKey>,
    ) -> Result<HostKeyDecision> {
        eprintln!("The authenticity of the host cannot be established.");
        eprintln!(
            "{} key fingerprint is SHA256:{}",
            presented.algorithm, presented.fingerprint_sha256
        );
        eprint!("Accept and remember this key? [y/N] ");
        let _ = io::stderr().flush();
        let mut line = String::new();
        io::stdin()
            .read_line(&mut line)
            .map_err(|e| Error::Other(e.to_string()))?;
        let answer = line.trim().to_ascii_lowercase();
        if answer == "y" || answer == "yes" {
            Ok(HostKeyDecision::AcceptAndRemember)
        } else {
            Ok(HostKeyDecision::Reject)
        }
    }
}

async fn run_shell(mgr: &SessionManager, host_id: Uuid) -> Result<()> {
    let (cols, rows) = crossterm::terminal::size()
        .map(|(c, r)| (u32::from(c), u32::from(r)))
        .unwrap_or((80, 24));
    let (mut pty, mut output) = mgr.open_pty(host_id, PtySize::new(cols, rows)).await?;

    enable_raw_mode().map_err(|e| Error::Other(e.to_string()))?;
    let _guard = RawModeGuard;

    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut buf = vec![0u8; 4096];

    loop {
        tokio::select! {
            read = stdin.read(&mut buf) => {
                match read {
                    Ok(0) => break,
                    Ok(n) => {
                        if pty.write(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = output.recv() => {
                match msg {
                    Some(data) => {
                        if stdout.write_all(&data).await.is_err() {
                            break;
                        }
                        let _ = stdout.flush().await;
                    }
                    None => break,
                }
            }
            _ = signal::ctrl_c() => {
                break;
            }
        }
    }

    pty.close().await?;
    Ok(())
}

struct RawModeGuard;

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
    }
}
